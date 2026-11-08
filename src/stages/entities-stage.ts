import {
  Effect,
  GAMEPLAY_STAGE_IDS,
  HOSTILE_SPAWN_BATCH_SIZE,
  PASSIVE_SPAWN_BATCH_SIZE,
  PASSIVE_SPAWN_INTERVAL_TICKS,
  NO_ATTEMPTS,
  Ref,
  applyFallingBlocks,
  hostileSpawnsAllowed,
  recordGameplayStageFailure,
  recordGameplayUnsupportedOperation,
  recordMobRuleIssues,
  rollCasualtyExperience,
  searchSpawnCandidates,
  settled,
  takeBatch,
} from './registration-core.js'
import { Brand, Equal, Option, Result, Schema } from 'effect'
import {
  AIR_BLOCK_ID,
  AngleRadians,
  BlockAxis,
  BlockBlastResistance,
  DeltaTimeSecs,
  DimensionIdSchema,
  CHUNK_SIZE_XZ,
  FixedDurationSecs,
  PositionAxis,
  ProjectileIdSchema,
  RandomSeed,
  SimulationTickSchema,
  WorldPositionSchema,
  WorldWriteBatchSchema,
  blockPosition,
  blockPositionKeyOf,
  propertyOfBlockId,
  position,
  resistsExplosion,
  type BlockPosition,
  type BlockPositionKey,
  type Dimension,
  type Position,
  type ProjectileId,
  type WorldWriteBatch,
} from '@nerima-games/mc-kernel'
import {
  DamageAmount,
  DamageCause,
  EntityId,
  PlayerServiceSnapshotSchema,
  PlayerStorageSnapshotSchema,
  ProjectileServiceSnapshotSchema,
  stepProjectile,
  TntServiceSnapshotSchema,
  WorldRevisionConflict,
  applyDamage as applyVitalsDamage,
  damageAt,
  ARROW_PROFILE,
  raycastArrowBlock,
  type ReplicatedOwnerCandidate,
  type PlayerStorage,
  type ProjectileLaunchRequest,
  type ProjectileProfile,
  type ProjectileWorld,
  type ProjectileHit,
} from '@nerima-games/mc-sim'
import type { ExplosionBlock, ExplosionBlockReader } from '@nerima-games/mc-sim'
import { craterCells } from '../domain/interactions/explosion-crater.js'
import {
  appendDroppedItemSpawns,
  DroppedItemOwnerSnapshotSchema,
  droppedItemPickupResultAfterCommit,
  planDroppedItemPickup,
  type DroppedItemSpawn,
  type DroppedItemOwnerSnapshot,
} from '../domain/entities/dropped-item.js'
import {
  ExperienceOrbOwnerSnapshotSchema,
  ExperienceOrbVitalsOwnerSnapshotSchema,
  experienceOrbAbsorptionResultAfterCommit,
  planExperienceOrbAbsorption,
} from '../domain/entities/xp-orb.js'
import {
  planEndermanTeleportRoster,
  planMobBlastRoster,
  planMobDamageRoster,
  planMobExplosionRoster,
  hasMobMovementCandidates,
  planMobMovementRoster,
  planMobRosterSweep,
  planSpawnAttemptsOnRoster,
  rollCasualtyDrops,
  type MobExplosionHit,
  type MobDamageHit,
  type MobAttackEvent,
  type MobProjectilePendingImpact,
  type MobSpawnAttempt,
  isDroppedItemBehaviour,
  isHostileMobSnapshot,
} from '../domain/entities/mob-frame.js'
import { chunkCoordsAround, openChunkWindow, UNREADABLE_BLOCK } from '../domain/chunk-window.js'
import { mobMovementWorldFromChunkWindow } from '../domain/entities/mob-movement-world.js'
import { burnsInDaylight } from '../domain/mob/undead-daylight.js'
import { SPIDER_KIND, BLAZE_KIND, SKELETON_KIND } from '../domain/mob/mob-ecosystem.js'
import type { BurningActor } from '../domain/fire-lifecycle.js'
import {
  resolveHostileContacts,
  prepareHostileAttack,
  prepareShieldBlocking,
  resolvePlayerBlastDamage,
  type DamageImmunityState,
  type ShieldBlockingState,
  type PlayerDamageEvent,
  type HostileAttackPreparation,
} from '../domain/mob/hostile-combat.js'
import { prepareArmorHit, type ArmorHitResolution } from '../domain/combat/armor.js'
import { disturb } from '../domain/falling-block.js'
import { TNT_EXPLOSION_POWER, type Explosion } from '../domain/mob/explosion.js'
import { PRIMED_TNT_KIND } from '../domain/entities/mob-frame.js'
import { SkyLightLevel, hostileSpawnSearchDue } from '../domain/mob/hostile-spawn.js'
import {
  GameplayEntityRosterSchema,
  GameplayTntSourcesSnapshotSchema,
  restoreGameplayEntityMetadata,
  type GameplayEntityRoster,
  type GameplayTntSourcesSnapshot,
} from './gameplay-owner-registrations.js'
import type {
  DroppedItemPickupExecution,
  ExperienceOrbAbsorptionExecution,
  GameplayStageContext,
  StageRegistration,
} from './registration-core.js'

type PlayerServiceSnapshot = Schema.Schema.Type<typeof PlayerServiceSnapshotSchema>

const unsupportedMobSimulation = (
  state: GameplayStageContext['state'],
  reason:
    | 'WorldCommitCoordinatorUnavailable'
    | 'OwnerRegistrationUnavailable'
    | 'EntityRosterOwnerUnavailable'
    | 'TntServiceUnavailable',
) => recordGameplayUnsupportedOperation(state, {
  _tag: 'Unsupported',
  action: 'MobSimulation',
  reason,
})

const mobMovementChunkCoords = (
  roster: GameplayEntityRoster,
  target: Position,
  dimension: string,
): ReadonlyArray<ReturnType<typeof chunkCoordsAround>[number]> => {
  const coords = new Map<string, ReturnType<typeof chunkCoordsAround>[number]>()
  const add = (at: Position, radius: number) => {
    for (const coord of chunkCoordsAround(at, radius)) coords.set(`${Number(coord.cx)},${Number(coord.cz)}`, coord)
  }
  add(target, 32)
  for (const entity of roster.entities) {
    if (entity.dimension === dimension) add(entity.feetPosition, 16)
  }
  return [...coords.values()]
}

const hasUndeadDaylightCandidates = (roster: GameplayEntityRoster, dimension: string): boolean =>
  roster.entities.some((entity) =>
    entity.dimension === dimension && (entity.kind === 'zombie' || entity.kind === 'skeleton'),
  )

const undeadDaylightChunkCoords = (
  roster: GameplayEntityRoster,
  dimension: string,
): ReadonlyArray<ReturnType<typeof chunkCoordsAround>[number]> => {
  const coords = new Map<string, ReturnType<typeof chunkCoordsAround>[number]>()
  for (const entity of roster.entities) {
    if (entity.dimension !== dimension || (entity.kind !== 'zombie' && entity.kind !== 'skeleton')) continue
    for (const coord of chunkCoordsAround(entity.feetPosition, 0)) {
      coords.set(`${Number(coord.cx)},${Number(coord.cz)}`, coord)
    }
  }
  return [...coords.values()]
}

const undeadDaylightFacts = (
  roster: GameplayEntityRoster,
  window: import('../domain/chunk-window.js').ChunkWindow,
  store: GameplayStageContext['store'],
  daytime: boolean,
  dimension: string,
): Effect.Effect<ReadonlyMap<import('@nerima-games/mc-sim').EntityId, Readonly<{ exposed: boolean; inWater: boolean }>>> =>
  Effect.gen(function* () {
    const facts = new Map<import('@nerima-games/mc-sim').EntityId, Readonly<{ exposed: boolean; inWater: boolean }>>()
    for (const entity of roster.entities) {
      if ((entity.kind !== 'zombie' && entity.kind !== 'skeleton') || entity.dimension !== dimension) continue
      const feetX = BlockAxis.result(Math.floor(entity.feetPosition.x))
      const feetY = BlockAxis.result(Math.floor(entity.feetPosition.y))
      const feetZ = BlockAxis.result(Math.floor(entity.feetPosition.z))
      const headY = BlockAxis.result(Math.floor(entity.feetPosition.y + 1.62))
      if (Result.isFailure(feetX) || Result.isFailure(feetY) || Result.isFailure(feetZ) || Result.isFailure(headY)) {
        facts.set(entity.id, { exposed: false, inWater: true })
        continue
      }
      const feetBlock = window.blockAt(feetX.success, feetY.success, feetZ.success)
      const feetFluid = feetBlock === UNREADABLE_BLOCK
        ? undefined
        : Result.getOrUndefined(propertyOfBlockId(feetBlock, 'fluid'))
      const inWater = feetFluid === undefined || feetFluid === 'water'
      const light = yield* store.getLight(blockPosition(feetX.success, headY.success, feetZ.success))
      const skyLight = SkyLightLevel(light._tag === 'Light' ? light.sky : -1)
      const rawBehaviour = isHostileMobSnapshot(entity.behaviour)
        ? entity.behaviour.behaviour
        : entity.behaviour
      const hasHeadProtection = rawBehaviour?._tag === 'EcosystemMob' && rawBehaviour.hasHeadProtection
      facts.set(entity.id, {
        exposed: burnsInDaylight({ daytime, skyLight, inWater, hasHeadProtection }),
        inWater,
      })
    }
    return facts
  })

const BlocksPerSecondSchema = Schema.Finite.pipe(Schema.brand('BlocksPerSecond'))
const BlocksPerSecondSquaredSchema = Schema.Finite.pipe(Schema.brand('BlocksPerSecondSquared'))
const PROJECTILE_FIXED_STEP_SECONDS = 1 / 20
const PROJECTILE_AGE_TOLERANCE_SECONDS = 1e-9
const BLAZE_FIREBALL_PROFILE: ProjectileProfile = {
  ...ARROW_PROFILE,
  gravity: Schema.decodeUnknownSync(BlocksPerSecondSquaredSchema)(0),
  airDrag: 1,
  waterDrag: 1,
  maxLifetimeSeconds: FixedDurationSecs(3),
}

const projectileAxis = (value: number): number & Brand.Brand<'PositionAxis'> =>
  Result.getOrThrow(PositionAxis.result(value))

const projectileAabb = (
  feet: Position,
  widthX: number,
  widthZ: number,
  height: number,
): ProjectileWorld['entities'][number]['bounds'] | undefined => {
  const values = [
    feet.x - widthX / 2,
    feet.y,
    feet.z - widthZ / 2,
    feet.x + widthX / 2,
    feet.y + height,
    feet.z + widthZ / 2,
  ]
  if (!values.every(Number.isFinite)) return undefined
  const decoded = values.map((value) => Result.getOrUndefined(PositionAxis.result(value)))
  if (decoded.some((value) => value === undefined)) return undefined
  return {
    minX: decoded[0]!,
    minY: decoded[1]!,
    minZ: decoded[2]!,
    maxX: decoded[3]!,
    maxY: decoded[4]!,
    maxZ: decoded[5]!,
  }
}

const projectileEntitySize = (kind: string): readonly [number, number] =>
  kind === SPIDER_KIND ? [1.4, 0.9]
    : kind === 'chicken' ? [0.4, 0.7]
      : kind === 'cow' || kind === 'sheep' ? [0.9, 1.4]
        : kind === 'pig' ? [0.9, 0.9]
          : kind === 'enderman' ? [0.6, 2.9]
            : [0.6, 1.8]

const projectileWorldFor = (
  roster: GameplayEntityRoster,
  player: Position,
  dimension: Dimension,
  window: import('../domain/chunk-window.js').ChunkWindow,
  coords: ReadonlyArray<ReturnType<typeof chunkCoordsAround>[number]>,
): ProjectileWorld | undefined => {
  if (coords.length === 0) return undefined
  const chunksX = coords.map(({ cx }) => Number(cx))
  const chunksZ = coords.map(({ cz }) => Number(cz))
  const worldBounds = [
    PositionAxis.result(Math.min(...chunksX) * CHUNK_SIZE_XZ),
    PositionAxis.result(0),
    PositionAxis.result(Math.min(...chunksZ) * CHUNK_SIZE_XZ),
    PositionAxis.result((Math.max(...chunksX) + 1) * CHUNK_SIZE_XZ),
    PositionAxis.result(256),
    PositionAxis.result((Math.max(...chunksZ) + 1) * CHUNK_SIZE_XZ),
  ]
  if (worldBounds.some(Result.isFailure)) return undefined
  const bounds: ProjectileWorld['entities'][number]['bounds'] = {
    minX: Result.getOrThrow(worldBounds[0]!),
    minY: Result.getOrThrow(worldBounds[1]!),
    minZ: Result.getOrThrow(worldBounds[2]!),
    maxX: Result.getOrThrow(worldBounds[3]!),
    maxY: Result.getOrThrow(worldBounds[4]!),
    maxZ: Result.getOrThrow(worldBounds[5]!),
  }
  const entities: ProjectileWorld['entities'][number][] = []
  const playerBounds = projectileAabb(player, 0.6, 0.6, 1.8)
  if (playerBounds !== undefined) entities.push({ id: PLAYER_BLAST_ENTITY_ID, bounds: playerBounds })
  for (const entity of roster.entities) {
    if (entity.dimension !== undefined && entity.dimension !== dimension) continue
    if (isDroppedItemBehaviour(entity.behaviour)) continue
    const [width, height] = projectileEntitySize(entity.kind)
    const entityBounds = projectileAabb(entity.feetPosition, width, width, height)
    if (entityBounds !== undefined) entities.push({ id: entity.id, bounds: entityBounds })
  }
  const blockAt = (x: number, y: number, z: number) => {
    const bx = BlockAxis.result(x)
    const by = BlockAxis.result(y)
    const bz = BlockAxis.result(z)
    if (Result.isFailure(bx) || Result.isFailure(by) || Result.isFailure(bz)) return UNREADABLE_BLOCK
    return window.blockAt(bx.success, by.success, bz.success)
  }
  const localShapeBoxes = (shape: string): ReadonlyArray<readonly [number, number, number, number, number, number]> => {
    switch (shape) {
      case 'none': return []
      case 'slab': return [[0, 0, 0, 1, 0.5, 1]]
      case 'cactus': return [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]]
      case 'pressurePlate': return [[0, 0, 0, 1, 1 / 16, 1]]
      default: return [[0, 0, 0, 1, 1, 1]]
    }
  }
  return {
    bounds,
    entities,
    isInWater: (at) => {
      const block = blockAt(Math.floor(at.x), Math.floor(at.y), Math.floor(at.z))
      return block !== UNREADABLE_BLOCK && Result.getOrUndefined(propertyOfBlockId(block, 'fluid')) === 'water'
    },
    blockBounds: (start, end) => {
      const minX = Math.floor(Math.min(start.x, end.x))
      const minY = Math.floor(Math.min(start.y, end.y))
      const minZ = Math.floor(Math.min(start.z, end.z))
      const maxX = Math.floor(Math.max(start.x, end.x))
      const maxY = Math.floor(Math.max(start.y, end.y))
      const maxZ = Math.floor(Math.max(start.z, end.z))
      if ([minX, minY, minZ, maxX, maxY, maxZ].some((value) => !Number.isSafeInteger(value))) return [bounds]
      if (maxX - minX > 16 || maxY - minY > 16 || maxZ - minZ > 16) return [bounds]
      const boxes: Array<ReturnType<ProjectileWorld['blockBounds']>[number]> = []
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            const block = blockAt(x, y, z)
            const shape = block === UNREADABLE_BLOCK
              ? 'full'
              : Result.getOrUndefined(propertyOfBlockId(block, 'collisionShape')) ?? 'full'
            for (const [localMinX, localMinY, localMinZ, localMaxX, localMaxY, localMaxZ] of localShapeBoxes(shape)) {
              boxes.push({
                minX: projectileAxis(x + localMinX),
                minY: projectileAxis(y + localMinY),
                minZ: projectileAxis(z + localMinZ),
                maxX: projectileAxis(x + localMaxX),
                maxY: projectileAxis(y + localMaxY),
                maxZ: projectileAxis(z + localMaxZ),
              })
            }
          }
        }
      }
      return boxes
    },
  }
}

const mobProjectileId = (source: string, tick: number, fireball: boolean): string =>
  `mx-gameplay:mob:${fireball ? 'fireball' : 'arrow'}:${source}:${tick}`

const projectileLineOfSight = (
  from: Position,
  to: Position,
  window: import('../domain/chunk-window.js').ChunkWindow,
): boolean => {
  const ray = raycastArrowBlock(from, to, (x, y, z) => {
    const bx = BlockAxis.result(Math.floor(x))
    const by = BlockAxis.result(Math.floor(y))
    const bz = BlockAxis.result(Math.floor(z))
    if (Result.isFailure(bx) || Result.isFailure(by) || Result.isFailure(bz)) return true
    const block = window.blockAt(bx.success, by.success, bz.success)
    return block === UNREADABLE_BLOCK || Result.getOrUndefined(propertyOfBlockId(block, 'collisionShape')) !== 'none'
  })
  return Result.isSuccess(ray) && Option.isNone(ray.success)
}

type MobProjectileStep = Readonly<{
  readonly impacts: ReadonlyArray<MobProjectilePendingImpact>
  readonly retiredIds: ReadonlyArray<ProjectileId>
}>

const noMobProjectileStep: MobProjectileStep = { impacts: [], retiredIds: [] }

const projectileLaunchTick = (id: string): number | undefined => {
  const launchTick = Number(id.slice(id.lastIndexOf(':') + 1))
  return Number.isSafeInteger(launchTick) && launchTick >= 0 ? launchTick : undefined
}

const pendingMobProjectileImpact = (
  id: ProjectileId,
  source: import('@nerima-games/mc-sim').EntityId,
  hit: ProjectileHit,
  dimension: Dimension,
): MobProjectilePendingImpact => {
  const point = Schema.decodeUnknownSync(WorldPositionSchema)({ dimension, ...hit.point })
  return {
    id,
    source,
    kind: String(id).includes(':fireball:') ? BLAZE_KIND : SKELETON_KIND,
    hit: hit.kind === 'entity'
      ? { kind: 'entity', entityId: hit.entityId, point }
      : { kind: 'block', point },
  }
}

const launchAndStepMobProjectiles = (
  context: GameplayStageContext,
  attacks: ReadonlyArray<MobAttackEvent>,
  roster: GameplayEntityRoster,
  playerPosition: Position,
  dimension: Dimension,
  tick: import('@nerima-games/mc-kernel').SimulationTick,
  window: import('../domain/chunk-window.js').ChunkWindow | undefined,
  store: GameplayStageContext['store'],
  coords: ReadonlyArray<ReturnType<typeof chunkCoordsAround>[number]>,
): Effect.Effect<MobProjectileStep, unknown> => Effect.gen(function* () {
  const { commit } = context
  const ranged = attacks.filter(({ mode }) => mode === 'projectile')
  if (commit === undefined) {
    if (ranged.length > 0) yield* unsupportedMobSimulation(context.state, 'WorldCommitCoordinatorUnavailable')
    return noMobProjectileStep
  }
  const service = commit.projectileService
  if (service === undefined || commit.projectileOwnerId === undefined) {
    let hasMobProjectiles = false
    if (commit.projectileOwnerId !== undefined) {
      const outstanding = yield* Effect.result(commit.coordinator.snapshot(
        commit.projectileOwnerId,
        ProjectileServiceSnapshotSchema,
      ))
      if (Result.isFailure(outstanding)) {
        if (outstanding.failure._tag === 'ReplicatedOwnerUnknown') {
          yield* unsupportedMobSimulation(context.state, 'OwnerRegistrationUnavailable')
          return noMobProjectileStep
        }
        return yield* Effect.fail(outstanding.failure)
      }
      const resolvedProjectileIds = new Set(roster.resolvedMobProjectileIds ?? [])
      hasMobProjectiles = outstanding.success.state.projectiles.some(({ id, dimension: projectileDimension }) =>
        projectileDimension === dimension && String(id).startsWith('mx-gameplay:mob:') && !resolvedProjectileIds.has(id))
    }
    if (ranged.length > 0 || hasMobProjectiles || (roster.pendingMobProjectileImpacts?.length ?? 0) > 0) {
      yield* unsupportedMobSimulation(context.state, 'OwnerRegistrationUnavailable')
    }
    return noMobProjectileStep
  }
  const currentTick = Number(tick)
  const resolvedProjectileIds = new Set((roster.resolvedMobProjectileIds ?? [])
    .filter((id) => projectileLaunchTick(String(id)) === currentTick))
  const initial = yield* service.snapshot
  const existingIds = new Set(initial.state.projectiles.map(({ id }) => String(id)))
  const hasUnresolvedMobProjectiles = initial.state.projectiles.some(({ id, dimension: recordDimension }) =>
    recordDimension === dimension && String(id).startsWith('mx-gameplay:mob:') && !resolvedProjectileIds.has(id))
  const pendingForDimension = (roster.pendingMobProjectileImpacts ?? [])
    .filter(({ hit }) => hit.point.dimension === dimension)
  if (ranged.length > 0 || hasUnresolvedMobProjectiles || pendingForDimension.length > 0) {
    if (commit.entitiesOwnerId === undefined || commit.playerOwnerId === undefined ||
      commit.playerStorageOwnerId === undefined || commit.vitalsOwnerId === undefined ||
      commit.droppedItemsOwnerId === undefined) {
      yield* unsupportedMobSimulation(context.state, 'OwnerRegistrationUnavailable')
      return noMobProjectileStep
    }
    const preflight = yield* Effect.result(Effect.all([
      commit.coordinator.snapshot(commit.entitiesOwnerId, GameplayEntityRosterSchema),
      commit.coordinator.snapshot(commit.playerOwnerId, PlayerServiceSnapshotSchema),
      commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema),
      commit.coordinator.snapshot(commit.vitalsOwnerId, ExperienceOrbVitalsOwnerSnapshotSchema),
      commit.coordinator.snapshot(commit.droppedItemsOwnerId, DroppedItemOwnerSnapshotSchema),
    ]))
    if (Result.isFailure(preflight)) {
      if (preflight.failure._tag === 'ReplicatedOwnerUnknown') {
        yield* unsupportedMobSimulation(context.state, 'OwnerRegistrationUnavailable')
        return noMobProjectileStep
      }
      return yield* Effect.fail(preflight.failure)
    }
  }
  let projectileWindow = window
  let world: ReturnType<typeof projectileWorldFor> = undefined
  if (ranged.length > 0 || hasUnresolvedMobProjectiles) {
    if (projectileWindow === undefined) projectileWindow = yield* openChunkWindow(store, coords)
    world = projectileWorldFor(roster, playerPosition, dimension, projectileWindow, coords)
    if (world === undefined) return yield* Effect.fail({ _tag: 'ProjectileWorldUnavailable' })
  }
  const sourceById = new Map(roster.entities.map((entity) => [entity.id, entity]))
  const newlyLaunchedIds = new Set<string>()
  for (const attack of ranged) {
    const source = sourceById.get(attack.source)
    if (source === undefined || (source.kind !== 'skeleton' && source.kind !== BLAZE_KIND)) continue
    const eyeY = PositionAxis.result(source.feetPosition.y + (source.kind === BLAZE_KIND ? 1.5 : 1.62))
    const targetY = PositionAxis.result(playerPosition.y + 1.62)
    if (Result.isFailure(eyeY) || Result.isFailure(targetY)) continue
    const from = position(PositionAxis(source.feetPosition.x), eyeY.success, PositionAxis(source.feetPosition.z))
    const to = position(PositionAxis(playerPosition.x), targetY.success, PositionAxis(playerPosition.z))
    if (projectileWindow === undefined) return yield* Effect.fail({ _tag: 'ProjectileWorldUnavailable' })
    if (!projectileLineOfSight(from, to, projectileWindow)) continue
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dz = to.z - from.z
    const horizontal = Math.hypot(dx, dz)
    if (!Number.isFinite(horizontal) || (horizontal === 0 && dy === 0)) continue
    const fireball = source.kind === BLAZE_KIND
    const rawId = mobProjectileId(String(source.id), Number(tick), fireball)
    const projectileId = Result.getOrUndefined(Schema.decodeUnknownResult(ProjectileIdSchema)(rawId))
    if (projectileId === undefined || existingIds.has(rawId) || resolvedProjectileIds.has(projectileId)) continue
    const request: ProjectileLaunchRequest = {
      projectileId,
      dimension,
      shooter: source.id,
      tick,
      expectedRevision: yield* commit.coordinator.revision,
      expectedDimensionRevision: yield* commit.coordinator.dimensionRevision(dimension),
      kind: 'projectile',
      position: from,
      yawRadians: AngleRadians(Math.atan2(-dx, -dz)),
      pitchRadians: AngleRadians(-Math.atan2(dy, horizontal)),
      speed: Schema.decodeUnknownSync(BlocksPerSecondSchema)(fireball ? 20 : 60),
      profile: fireball ? BLAZE_FIREBALL_PROFILE : ARROW_PROFILE,
    }
    yield* service.launch(request)
    existingIds.add(rawId)
    newlyLaunchedIds.add(rawId)
  }

  const projectileSnapshot = yield* service.snapshot
  const mobRecords = projectileSnapshot.state.projectiles.filter(({ id, dimension: recordDimension }) => {
    const value = String(id)
    return value.startsWith('mx-gameplay:mob:') && recordDimension === dimension && !resolvedProjectileIds.has(id)
  })
  if (mobRecords.length === 0 && pendingForDimension.length === 0) return noMobProjectileStep
  if (mobRecords.length > 0 && world === undefined) {
    return yield* Effect.fail({ _tag: 'ProjectileWorldUnavailable' })
  }

  if (commit.entitiesOwnerId === undefined) {
    return yield* Effect.fail({ _tag: 'MobProjectileOwnerUnavailable' })
  }
  const entitySnapshot = yield* commit.coordinator.snapshot(commit.entitiesOwnerId, GameplayEntityRosterSchema)
  if (projectileSnapshot.revision !== entitySnapshot.revision) {
    return yield* Effect.fail(new WorldRevisionConflict({
      expected: projectileSnapshot.revision,
      actual: entitySnapshot.revision,
    }))
  }
  const dimensionRevision = yield* commit.coordinator.dimensionRevision(dimension)
  const currentPending = entitySnapshot.state.pendingMobProjectileImpacts ?? []
  const pendingById = new Map(currentPending.map((impact) => [impact.id, impact]))
  const newPending: MobProjectilePendingImpact[] = []
  const toStep: Array<Readonly<{
    id: ProjectileId
    record: typeof mobRecords[number]
    previewHit: boolean
  }>> = []
  const retiredIds: ProjectileId[] = []

  for (const record of mobRecords) {
    if (pendingById.has(record.id)) continue
    if (record.projectile.state === 'stuck') {
      newPending.push(pendingMobProjectileImpact(record.id, record.shooter, record.projectile.hit, record.dimension))
      continue
    }
    if (record.projectile.state === 'despawned') {
      if (record.projectile.reason === 'entity-hit') {
        return yield* Effect.fail({ _tag: 'MobProjectileImpactOutcomeUnavailable', projectileId: record.id })
      }
      retiredIds.push(record.id)
      continue
    }
    const id = String(record.id)
    const launchTick = projectileLaunchTick(id)
    if (launchTick === undefined) continue
    if (launchTick === currentTick && !newlyLaunchedIds.has(id)) continue
    const expectedAge = Math.max(0, (currentTick - launchTick) * PROJECTILE_FIXED_STEP_SECONDS)
    if (record.projectile.ageSeconds + PROJECTILE_AGE_TOLERANCE_SECONDS >= expectedAge + PROJECTILE_FIXED_STEP_SECONDS) continue
    const previewWorld = world
    if (previewWorld === undefined) return yield* Effect.fail({ _tag: 'ProjectileWorldUnavailable' })
    const preview = stepProjectile(
      record.projectile,
      DeltaTimeSecs(PROJECTILE_FIXED_STEP_SECONDS),
      previewWorld,
      record.profile,
    )
    toStep.push({ id: record.id, record, previewHit: preview.hit !== undefined })
    if (preview.hit !== undefined) {
      newPending.push(pendingMobProjectileImpact(record.id, record.shooter, preview.hit, record.dimension))
    }
  }

  const mergedPending = new Map(pendingById)
  for (const impact of newPending) mergedPending.set(impact.id, impact)
  const pendingCandidate = [...mergedPending.values()]
  let expectedRevision = entitySnapshot.revision
  if (!Equal.equals(currentPending, pendingCandidate)) {
    const delta = yield* commit.coordinator.commit({
      expectedRevision: entitySnapshot.revision,
      expectedDimensions: [],
      changes: [{
        ownerId: commit.entitiesOwnerId,
        state: { ...entitySnapshot.state, pendingMobProjectileImpacts: pendingCandidate },
      }],
    })
    expectedRevision = delta.revision
  }

  for (const candidate of toStep) {
    const stepWorld = world
    if (stepWorld === undefined) return yield* Effect.fail({ _tag: 'ProjectileWorldUnavailable' })
    const outcome = yield* service.step({
      projectileId: candidate.id,
      tick,
      expectedRevision,
      expectedDimensionRevision: dimensionRevision,
      deltaTime: DeltaTimeSecs(PROJECTILE_FIXED_STEP_SECONDS),
      world: stepWorld,
      blockAddressOfHit: (hit) => {
        const x = BlockAxis.result(Math.floor(hit.point.x))
        const y = BlockAxis.result(Math.floor(hit.point.y))
        const z = BlockAxis.result(Math.floor(hit.point.z))
        if (Result.isFailure(x) || Result.isFailure(y) || Result.isFailure(z)) return undefined
        const decodedDimension = Schema.decodeUnknownResult(DimensionIdSchema)(candidate.record.dimension)
        if (Result.isFailure(decodedDimension)) return undefined
        return { dimension: decodedDimension.success, position: blockPosition(x.success, y.success, z.success) }
      },
    })
    if (candidate.previewHit !== (outcome.hit !== undefined)) {
      return yield* Effect.fail({ _tag: 'MobProjectilePreviewMismatch', projectileId: candidate.id })
    }
    expectedRevision = outcome.revision
  }

  const impacts = [...mergedPending.values()].filter(({ hit }) => hit.point.dimension === dimension)
  return { impacts, retiredIds }
})

type MobProjectileResolution = Readonly<{
  readonly playerDamages: ReadonlyArray<PlayerDamageEvent>
  readonly drops: ReturnType<typeof rollCasualtyDrops>['drops']
  readonly experience: ReturnType<typeof rollCasualtyExperience>['experience']
  readonly seed: number
  readonly shield: ShieldBlockingState | null
  readonly immunity: DamageImmunityState | null
  readonly ignitions: ReadonlyArray<BurningActor>
}>

const resolveMobProjectileImpactsOnce = (
  context: GameplayStageContext,
  impacts: ReadonlyArray<MobProjectilePendingImpact>,
  retiredIds: ReadonlyArray<ProjectileId>,
  dimension: Dimension,
  tick: import('@nerima-games/mc-kernel').SimulationTick,
  difficulty: import('../domain/survival-hunger.js').SurvivalDifficulty,
  seed: number,
  currentShield: ShieldBlockingState | null,
  currentImmunity: DamageImmunityState | null,
): Effect.Effect<MobProjectileResolution, unknown> => Effect.gen(function* () {
  const { commit } = context
  const noChange: MobProjectileResolution = {
    playerDamages: [],
    drops: [],
    experience: [],
    seed,
    shield: currentShield,
    immunity: currentImmunity,
    ignitions: [],
  }
  if (impacts.length === 0 && retiredIds.length === 0) return noChange
  if (commit === undefined) {
    return yield* Effect.fail({ _tag: 'MobProjectileOwnerUnavailable' })
  }
  const entitiesOwnerId = commit.entitiesOwnerId
  const projectileOwnerId = commit.projectileOwnerId
  if (entitiesOwnerId === undefined || projectileOwnerId === undefined) {
    return yield* Effect.fail({ _tag: 'MobProjectileOwnerUnavailable' })
  }

  const entitySnapshot = yield* commit.coordinator.snapshot(entitiesOwnerId, GameplayEntityRosterSchema)
  const expectedRevision = entitySnapshot.revision
  const resolved = new Set(entitySnapshot.state.resolvedMobProjectileIds ?? [])
  const pendingImpacts = impacts.filter(({ id }) => !resolved.has(id))
  const consumedIds = new Set(impacts.map(({ id }) => id))
  const projectileSnapshot = yield* commit.coordinator.snapshot(projectileOwnerId, ProjectileServiceSnapshotSchema)
  if (projectileSnapshot.revision !== expectedRevision) {
    return yield* Effect.fail(new WorldRevisionConflict({
      expected: expectedRevision,
      actual: projectileSnapshot.revision,
    }))
  }
  const playerImpacts = pendingImpacts.filter(({ hit }) => hit.kind === 'entity' && hit.entityId === PLAYER_BLAST_ENTITY_ID)
  const entityById = new Map(entitySnapshot.state.entities.map((entity) => [entity.id, entity]))
  const mobHits: MobDamageHit[] = pendingImpacts.flatMap((impact) => {
    if (impact.hit.kind !== 'entity' || !entityById.has(impact.hit.entityId)) return []
    return [{
      id: impact.hit.entityId,
      damage: { amount: impact.kind === BLAZE_KIND ? 6 : 3, cause: impact.kind === BLAZE_KIND ? 'in_fire' : 'projectile' },
      burning: impact.kind === BLAZE_KIND,
    }]
  })
  const damagePlan = planMobDamageRoster(entitySnapshot.state, mobHits, tick)
  const casualtyDrops = rollCasualtyDrops(damagePlan.casualties, seed)
  const casualtyExperience = rollCasualtyExperience(damagePlan.casualties, casualtyDrops.seed)
  const entityCandidate = restoreGameplayEntityMetadata(
    damagePlan.roster,
    entitySnapshot.state,
    dimension,
  )
  const currentTick = Number(tick)
  const resolvedMobProjectileIds = new Set(
    [...resolved].filter((id) => projectileLaunchTick(String(id)) === currentTick),
  )
  for (const impact of impacts) resolvedMobProjectileIds.add(impact.id)
  const entityCandidateWithProjectileMarkers = {
    ...entityCandidate,
    resolvedMobProjectileIds: [...resolvedMobProjectileIds],
    pendingMobProjectileImpacts: (entitySnapshot.state.pendingMobProjectileImpacts ?? [])
      .filter(({ id }) => !consumedIds.has(id)),
  }
  const projectileCandidate = {
    projectiles: projectileSnapshot.state.projectiles.filter(({ id }) =>
      !consumedIds.has(id) && !retiredIds.includes(id)),
  }

  let storageSnapshot: Readonly<{ revision: number; state: PlayerStorage }> | undefined
  let vitalsSnapshot: Readonly<{ revision: number; state: { readonly vitals: import('@nerima-games/mc-sim').Vitals } }> | undefined
  let storage: PlayerStorage | undefined
  let vitals: import('@nerima-games/mc-sim').Vitals | undefined
  let shield = currentShield
  let immunity = currentImmunity
  const playerDamages: PlayerDamageEvent[] = []
  const ignitedPlayers = new Set<string>()
  if (playerImpacts.length > 0) {
    if (commit.playerStorageOwnerId === undefined || commit.vitalsOwnerId === undefined || commit.playerOwnerId === undefined) {
      return yield* Effect.fail({ _tag: 'MobProjectilePlayerOwnerUnavailable' })
    }
    const [playerSnapshot, readStorage, readVitals] = yield* Effect.all([
      commit.coordinator.snapshot(commit.playerOwnerId, PlayerServiceSnapshotSchema),
      commit.coordinator.snapshot(commit.playerStorageOwnerId, PlayerStorageSnapshotSchema),
      commit.coordinator.snapshot(commit.vitalsOwnerId, ExperienceOrbVitalsOwnerSnapshotSchema),
    ])
    if (playerSnapshot.revision !== expectedRevision || readStorage.revision !== expectedRevision || readVitals.revision !== expectedRevision) {
      return yield* Effect.fail(new WorldRevisionConflict({
        expected: expectedRevision,
        actual: playerSnapshot.revision !== expectedRevision
          ? playerSnapshot.revision
          : readStorage.revision !== expectedRevision
            ? readStorage.revision
            : readVitals.revision,
      }))
    }
    storageSnapshot = readStorage
    vitalsSnapshot = readVitals
    storage = readStorage.state
    vitals = readVitals.state.vitals
    const playerPose = playerSnapshot.state.pose
    const pose = {
      feetPosition: {
        x: playerPose.feetPosition.x,
        y: playerPose.feetPosition.y,
        z: playerPose.feetPosition.z,
      },
      yawRadians: playerPose.yawRadians,
      pitchRadians: playerPose.pitchRadians,
    }
    for (const impact of playerImpacts) {
      const attacker = entityById.get(impact.source)
      const attackerAt = attacker?.feetPosition ?? impact.hit.point
      const burning = impact.kind === BLAZE_KIND
      const incoming = {
        attacker: impact.source,
        attackerPosition: Schema.decodeUnknownSync(WorldPositionSchema)({ dimension, ...attackerAt }),
        kind: 'projectile' as const,
        amount: burning ? 6 : 3,
      }
      const intent = {
        _tag: 'SetShieldBlocking' as const,
        actor: PLAYER_BLAST_ENTITY_ID,
        blocking: shield !== null,
      }
      const prepared: HostileAttackPreparation = yield* Effect.fromResult(prepareHostileAttack(intent, {
        tick,
        dimension,
        pose,
        hasShield: storage.equipment.slots.offhand?.item === 'shield',
        currentShield: shield,
        incoming,
        difficulty,
        damageState: immunity,
      }))
      shield = prepared.shield.blocking && prepared.shield.raisedAt !== null
        ? { actor: prepared.shield.actor, raisedAt: prepared.shield.raisedAt }
        : null
      immunity = prepared.damageState
      if (prepared.shield.durabilityDamage > 0) {
        storage = damageAt(storage, { _tag: 'Equipment', slot: 'offhand' }, prepared.shield.durabilityDamage).storage
        if (storage.equipment.slots.offhand?.item !== 'shield') shield = null
      }
      if (prepared.appliedAmount === 0) continue
      const armor: ArmorHitResolution = yield* Effect.fromResult(prepareArmorHit(storage.equipment, {
        amount: prepared.appliedAmount,
        cause: impact.kind === BLAZE_KIND ? 'in_fire' : 'projectile',
      }))
      const amount = yield* Effect.fromResult(DamageAmount.result(armor.damage.amount))
      const cause = yield* Effect.fromResult(DamageCause.result(armor.damage.cause))
      vitals = applyVitalsDamage(vitals, { amount, cause })
      for (const slot of armor.wornSlots) {
        storage = damageAt(storage, { _tag: 'Equipment', slot }, armor.durabilityWear).storage
      }
      playerDamages.push({
        _tag: 'HostileContact',
        source: impact.source,
        kind: impact.kind,
        at: impact.hit.point,
        damage: armor.damage,
      })
      if (impact.kind === BLAZE_KIND) ignitedPlayers.add(impact.id)
    }
  }

  let droppedCandidate: DroppedItemOwnerSnapshot | undefined
  if (casualtyDrops.drops.length > 0) {
    if (commit.droppedItemsOwnerId === undefined) {
      return yield* Effect.fail({ _tag: 'MobProjectileDropOwnerUnavailable' })
    }
    const snapshot = yield* commit.coordinator.snapshot(commit.droppedItemsOwnerId, DroppedItemOwnerSnapshotSchema)
    if (snapshot.revision !== expectedRevision) {
      return yield* Effect.fail(new WorldRevisionConflict({ expected: expectedRevision, actual: snapshot.revision }))
    }
    droppedCandidate = yield* Effect.fromResult(appendDroppedItemSpawns(
      snapshot.state,
      casualtyDrops.drops.map(({ item, count, at }) => ({ item, count, at })),
      expectedRevision,
    ))
  }

  const changes: ReplicatedOwnerCandidate[] = []
  if (!Equal.equals(entitySnapshot.state, entityCandidateWithProjectileMarkers)) {
    changes.push({ ownerId: entitiesOwnerId, state: entityCandidateWithProjectileMarkers })
  }
  if (!Equal.equals(projectileSnapshot.state, projectileCandidate)) {
    changes.push({ ownerId: projectileOwnerId, state: projectileCandidate })
  }
  if (storageSnapshot !== undefined && storage !== undefined && !Equal.equals(storageSnapshot.state, storage)) {
    changes.push({ ownerId: commit.playerStorageOwnerId, state: storage })
  }
  if (vitalsSnapshot !== undefined && vitals !== undefined && !Equal.equals(vitalsSnapshot.state.vitals, vitals)) {
    const vitalsOwnerId = commit.vitalsOwnerId
    if (vitalsOwnerId === undefined) {
      return yield* Effect.fail({ _tag: 'MobProjectileVitalsOwnerUnavailable' })
    }
    changes.push({ ownerId: vitalsOwnerId, state: { vitals } })
  }
  if (droppedCandidate !== undefined && commit.droppedItemsOwnerId !== undefined) {
    changes.push({ ownerId: commit.droppedItemsOwnerId, state: droppedCandidate })
  }
  if (changes.length > 0) {
    yield* commit.coordinator.commit({ expectedRevision, expectedDimensions: [], changes })
  }

  const livingEntityIds = new Set(damagePlan.roster.entities.map(({ id }) => id))
  const ignitions: BurningActor[] = pendingImpacts.flatMap((impact): ReadonlyArray<BurningActor> => {
    const hit = impact.hit
    if (impact.kind !== BLAZE_KIND || hit.kind !== 'entity') return []
    if (hit.entityId === PLAYER_BLAST_ENTITY_ID) {
      if (!ignitedPlayers.has(impact.id)) return []
      return [{
        id: 'player',
        kind: 'player',
        position: { x: Math.floor(hit.point.x), y: Math.floor(hit.point.y), z: Math.floor(hit.point.z) },
        remainingTicks: 100,
        damageCooldownTicks: 20,
      }]
    }
    if (!livingEntityIds.has(hit.entityId)) return []
    const target = damagePlan.roster.entities.find(({ id }) => id === hit.entityId)
    if (target === undefined) return []
    return [{
      id: String(target.id),
      kind: 'entity',
      position: { x: Math.floor(target.feetPosition.x), y: Math.floor(target.feetPosition.y), z: Math.floor(target.feetPosition.z) },
      remainingTicks: 100,
      damageCooldownTicks: 20,
    }]
  })
  return {
    playerDamages,
    drops: casualtyDrops.drops,
    experience: casualtyExperience.experience,
    seed: casualtyExperience.seed,
    shield,
    immunity,
    ignitions,
  }
})

const resolveMobProjectileImpacts = (
  context: GameplayStageContext,
  impacts: ReadonlyArray<MobProjectilePendingImpact>,
  retiredIds: ReadonlyArray<ProjectileId>,
  dimension: Dimension,
  tick: import('@nerima-games/mc-kernel').SimulationTick,
  difficulty: import('../domain/survival-hunger.js').SurvivalDifficulty,
  seed: number,
  currentShield: ShieldBlockingState | null,
  currentImmunity: DamageImmunityState | null,
): Effect.Effect<MobProjectileResolution, unknown> => {
  const retryRevisionConflict = (retriesRemaining: number): Effect.Effect<MobProjectileResolution, unknown> =>
    resolveMobProjectileImpactsOnce(
      context,
      impacts,
      retiredIds,
      dimension,
      tick,
      difficulty,
      seed,
      currentShield,
      currentImmunity,
    ).pipe(Effect.catchIf(
      (error): error is WorldRevisionConflict => error instanceof WorldRevisionConflict,
      (error) => retriesRemaining > 0
        ? retryRevisionConflict(retriesRemaining - 1)
        : Effect.fail(error),
    ))
  return retryRevisionConflict(2)
}

const explosionReadPositions = (
  center: Readonly<{ x: number; y: number; z: number }>,
): Effect.Effect<ReadonlyArray<BlockPosition>, unknown> => Effect.gen(function* () {
  const axisRange = (coordinate: number) => Effect.gen(function* () {
    const first = BlockAxis.result(Math.floor(coordinate - TNT_EXPLOSION_POWER))
    const last = BlockAxis.result(Math.floor(coordinate + TNT_EXPLOSION_POWER))
    if (Result.isFailure(first)) return yield* Effect.fail(first.failure)
    if (Result.isFailure(last)) return yield* Effect.fail(last.failure)
    const values: Array<BlockPosition['x']> = []
    for (let index = 0; index <= last.success - first.success; index += 1) {
      values.push(Result.getOrThrow(BlockAxis.result(first.success + index)))
    }
    return values
  })
  const [xs, ys, zs] = yield* Effect.all([
    axisRange(center.x),
    axisRange(center.y),
    axisRange(center.z),
  ])
  const positions: BlockPosition[] = []
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) positions.push(blockPosition(x, y, z))
    }
  }
  return positions
})

const explosionBlockReader = (
  blocks: ReadonlyArray<Readonly<{
    position: BlockPosition
    reading: Readonly<{ _tag: 'Block'; block: import('@nerima-games/mc-kernel').BlockId }>
      | Readonly<{ _tag: 'ChunkNotLoaded' }>
      | Readonly<{ _tag: 'OutOfWorld' }>
  }>>,
): ExplosionBlockReader => {
  const byPosition = new Map<string, ExplosionBlock>()
  for (const { position: cell, reading } of blocks) {
    if (reading._tag !== 'Block') continue
    const resistance = Result.getOrThrow(propertyOfBlockId(reading.block, 'blastResistance'))
    byPosition.set(blockPositionKeyOf(cell), {
      resistance: Number.isFinite(resistance)
        ? Math.min(resistance, Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER,
      destructible: Number.isFinite(resistance),
    })
  }
  return ({ x, y, z }) => byPosition.get(blockPositionKeyOf(blockPosition(
    Result.getOrThrow(BlockAxis.result(x)),
    Result.getOrThrow(BlockAxis.result(y)),
    Result.getOrThrow(BlockAxis.result(z)),
  )))
}

const PLAYER_BLAST_ENTITY_ID = EntityId('mx-gameplay:player-avatar')

const runTntSimulation = (
  context: GameplayStageContext,
  dt: DeltaTimeSecs,
): Effect.Effect<undefined, unknown> => Effect.gen(function* () {
  if (context.options.mobSimulation === false) return
  const { commit, state } = context
  if (commit === undefined) return

  if (commit.tntService === undefined) {
    if (commit.tntOwnerId === undefined) return
    const tntSnapshot = yield* Effect.result(commit.coordinator.snapshot(
      commit.tntOwnerId,
      TntServiceSnapshotSchema,
    ))
    if (Result.isFailure(tntSnapshot)) {
      if (tntSnapshot.failure._tag === 'ReplicatedOwnerUnknown') {
        yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
        return
      }
      return yield* Effect.fail(tntSnapshot.failure)
    }
    if (tntSnapshot.success.state.tnts.some(({ state: tntState }) => tntState.kind === 'primed')) {
      yield* unsupportedMobSimulation(state, 'TntServiceUnavailable')
    }
    return
  }

  const initial = yield* Effect.result(commit.tntService.snapshot)
  if (Result.isFailure(initial)) {
    if (initial.failure._tag === 'ReplicatedOwnerUnknown') {
      yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
      return
    }
    return yield* Effect.fail(initial.failure)
  }
  const primedIds = initial.success.state.tnts
    .filter(({ state: tntState }) => tntState.kind === 'primed')
    .map(({ id }) => id)
  if (primedIds.length === 0) return
  if (commit.tntOwnerId === undefined) {
    yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
    return
  }
  const entityOwnerId = commit.entitiesOwnerId

  for (const id of primedIds) {
    const current = yield* commit.tntService.snapshot
    const record = current.state.tnts.find((candidate) => candidate.id === id)
    if (record === undefined || record.state.kind !== 'primed') continue
    const expectedDimensionRevision = yield* commit.coordinator.dimensionRevision(record.dimension)
    const willDetonate = record.state.remainingFuseSecs <= dt
    const seed = yield* Ref.get(state.rollSeed)
    let entityRoster: GameplayEntityRoster | undefined
    let playerState: PlayerServiceSnapshot | undefined
    let tntSourcesSnapshot: GameplayTntSourcesSnapshot | undefined
    let blocks = explosionBlockReader([])
    let explosionEntities: ReadonlyArray<{ readonly id: import('@nerima-games/mc-kernel').EntityId; readonly feetPosition: Position }> = []

    if (willDetonate) {
      const tntSourcesOwnerId = commit.tntSourcesOwnerId
      if (tntSourcesOwnerId === undefined) {
        yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
        return
      }
      const tntSourcesSnapshotResult = yield* commit.coordinator.snapshot(
        tntSourcesOwnerId,
        GameplayTntSourcesSnapshotSchema,
      )
      if (tntSourcesSnapshotResult.revision !== current.revision) {
        return yield* Effect.fail(new WorldRevisionConflict({
          expected: current.revision,
          actual: tntSourcesSnapshotResult.revision,
        }))
      }
      tntSourcesSnapshot = tntSourcesSnapshotResult.state
      if (entityOwnerId === undefined) {
        yield* unsupportedMobSimulation(state, 'EntityRosterOwnerUnavailable')
        return
      }
      const reads = yield* explosionReadPositions(record.center)
      const observed = yield* commit.coordinator.observe(
        entityOwnerId,
        GameplayEntityRosterSchema,
        reads.map((readPosition) => ({ dimension: record.dimension, position: readPosition })),
      )
      const player = yield* commit.coordinator.snapshot(commit.playerOwnerId, PlayerServiceSnapshotSchema)
      if (observed.revision !== current.revision || player.revision !== current.revision) {
        return yield* Effect.fail(new WorldRevisionConflict({
          expected: current.revision,
          actual: observed.revision !== current.revision ? observed.revision : player.revision,
        }))
      }
      entityRoster = observed.state
      playerState = player.state
      blocks = explosionBlockReader(observed.blocks)
      const mobEntities = observed.state.entities
        .filter(({ dimension }) => dimension === record.dimension)
        .map(({ id: entityId, feetPosition }) => ({
          id: entityId,
          feetPosition,
        }))
      const playerPosition = player.state.pose.feetPosition
      explosionEntities = playerPosition.dimension === record.dimension
        ? [...mobEntities, {
            id: PLAYER_BLAST_ENTITY_ID,
            feetPosition: position(
              PositionAxis(playerPosition.x),
              PositionAxis(playerPosition.y),
              PositionAxis(playerPosition.z),
            ),
          }]
        : mobEntities
    }

    const outcome = yield* commit.tntService.advance({
      id,
      deltaTimeSecs: dt,
      expectedRevision: current.revision,
      expectedDimensionRevision,
      radius: TNT_EXPLOSION_POWER,
      seed,
      blocks,
      entities: explosionEntities,
    })
    if (outcome._tag !== 'DetonationPlanned') continue
    // The TNT service can plan detonation only after the fuse-due snapshot path above.
    const roster = Option.getOrThrow(Option.fromNullishOr(entityRoster))
    const player = Option.getOrThrow(Option.fromNullishOr(playerState))
    const effects = outcome.explosion.entityEffects
    const sources = Option.getOrThrow(Option.fromNullishOr(tntSourcesSnapshot))
    const playerTriggeredTnt = sources.sources.some((source) => source.tntId === id)
    const mobHits = effects.flatMap((effect): ReadonlyArray<MobExplosionHit> => {
      if (!roster.entities.some(({ id: entityId, dimension }) =>
        entityId === effect.id && dimension === record.dimension)) return []
      const hit: MobExplosionHit = {
        id: effect.id,
        damage: { amount: effect.damage, cause: 'explosion' },
        knockback: effect.knockback,
        ...(playerTriggeredTnt ? { killCredit: 'player-triggered-tnt' } : {}),
      }
      return [hit]
    })
    const deathTick = Schema.decodeUnknownSync(SimulationTickSchema)(yield* Ref.get(state.tickCount))
    const mobBlast = planMobExplosionRoster(roster, mobHits, deathTick)
    const loot = rollCasualtyDrops(mobBlast.casualties, seed)
    const casualtyExperience = rollCasualtyExperience(mobBlast.casualties, loot.seed)
    const explosion: Explosion = { source: 'tnt', power: TNT_EXPLOSION_POWER }
    const playerEffect = player.pose.feetPosition.dimension === record.dimension
      ? effects.find(({ id: effectId }) => effectId === PLAYER_BLAST_ENTITY_ID)
      : undefined
    let playerDamage: PlayerDamageEvent | undefined

    let playerCandidate: PlayerServiceSnapshot | undefined
    let storageCandidate: PlayerStorage | undefined
    let vitalsCandidate: { readonly vitals: import('@nerima-games/mc-sim').Vitals } | undefined
    if (playerEffect !== undefined) {
      // TntService emits effects only for positive exposure; its damage formula adds one.
      const damageEvent: PlayerDamageEvent = {
        _tag: 'Explosion',
        source: id,
        kind: PRIMED_TNT_KIND,
        at: outcome.explosion.center,
        explosion,
        damage: { amount: playerEffect.damage, cause: 'explosion' },
      }
      playerDamage = damageEvent
      const playerOwnerId = commit.playerOwnerId
      const playerStorageOwnerId = commit.playerStorageOwnerId
      const vitalsOwnerId = commit.vitalsOwnerId
      if (playerOwnerId === undefined || playerStorageOwnerId === undefined || vitalsOwnerId === undefined) {
        yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
        return
      }
      const [storageSnapshot, vitalsSnapshot] = yield* Effect.all([
        commit.coordinator.snapshot(playerStorageOwnerId, PlayerStorageSnapshotSchema),
        commit.coordinator.snapshot(vitalsOwnerId, ExperienceOrbVitalsOwnerSnapshotSchema),
      ])
      if (storageSnapshot.revision !== outcome.expectedRevision || vitalsSnapshot.revision !== outcome.expectedRevision) {
        return yield* Effect.fail(new WorldRevisionConflict({
          expected: outcome.expectedRevision,
          actual: storageSnapshot.revision !== outcome.expectedRevision
            ? storageSnapshot.revision
            : vitalsSnapshot.revision,
        }))
      }
      let storage = storageSnapshot.state
      let vitals = vitalsSnapshot.state.vitals
      const armor = yield* Effect.fromResult(prepareArmorHit(storage.equipment, damageEvent.damage))
      const amount = yield* Effect.fromResult(DamageAmount.result(armor.damage.amount))
      const cause = yield* Effect.fromResult(DamageCause.result(armor.damage.cause))
      vitals = applyVitalsDamage(vitals, { amount, cause })
      for (const slot of armor.wornSlots) {
        const worn = damageAt(storage, { _tag: 'Equipment', slot }, armor.durabilityWear)
        storage = worn.storage
      }
      if (!Equal.equals(storageSnapshot.state, storage)) storageCandidate = storage
      if (!Equal.equals(vitalsSnapshot.state.vitals, vitals)) vitalsCandidate = { vitals }
      const moved = playerEffect.knockback
      const positionAfterBlast = {
        ...player.pose.feetPosition,
        x: player.pose.feetPosition.x + moved.x,
        y: player.pose.feetPosition.y + moved.y,
        z: player.pose.feetPosition.z + moved.z,
      }
      if (
        positionAfterBlast.x !== player.pose.feetPosition.x ||
        positionAfterBlast.y !== player.pose.feetPosition.y ||
        positionAfterBlast.z !== player.pose.feetPosition.z
      ) {
        playerCandidate = yield* Schema.decodeUnknownEffect(PlayerServiceSnapshotSchema)({
          ...player,
          pose: { ...player.pose, feetPosition: positionAfterBlast },
        })
      }
    }

    const tntSourcesOwnerId = commit.tntSourcesOwnerId
    const tntSourcesCandidate = sources.sources.some((source) => source.tntId === id)
      ? Schema.decodeUnknownSync(GameplayTntSourcesSnapshotSchema)({
          sources: sources.sources.filter((source) => source.tntId !== id),
        })
      : undefined

    let droppedCandidate: DroppedItemOwnerSnapshot | undefined
    if (loot.drops.length > 0) {
      const droppedItemsOwnerId = commit.droppedItemsOwnerId
      if (droppedItemsOwnerId === undefined) {
        yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
        return
      }
      const droppedSnapshot = yield* commit.coordinator.snapshot(
        droppedItemsOwnerId,
        DroppedItemOwnerSnapshotSchema,
      )
      if (droppedSnapshot.revision !== outcome.expectedRevision) {
        return yield* Effect.fail(new WorldRevisionConflict({
          expected: outcome.expectedRevision,
          actual: droppedSnapshot.revision,
        }))
      }
      const drops: ReadonlyArray<DroppedItemSpawn> = loot.drops.map(({ item, count, at }) => ({ item, count, at }))
      droppedCandidate = yield* Effect.fromResult(
        appendDroppedItemSpawns(droppedSnapshot.state, drops, outcome.expectedRevision),
      )
    }

    const changes: ReplicatedOwnerCandidate[] = []
    if (!Equal.equals(roster, mobBlast.roster)) {
      changes.push({
        ownerId: Option.getOrThrow(Option.fromNullishOr(entityOwnerId)),
        state: mobBlast.roster,
      })
    }
    if (playerCandidate !== undefined) changes.push({ ownerId: commit.playerOwnerId, state: playerCandidate })
    if (storageCandidate !== undefined && commit.playerStorageOwnerId !== undefined) {
      changes.push({ ownerId: commit.playerStorageOwnerId, state: storageCandidate })
    }
    if (vitalsCandidate !== undefined && commit.vitalsOwnerId !== undefined) {
      changes.push({ ownerId: commit.vitalsOwnerId, state: vitalsCandidate })
    }
    if (droppedCandidate !== undefined && commit.droppedItemsOwnerId !== undefined) {
      changes.push({ ownerId: commit.droppedItemsOwnerId, state: droppedCandidate })
    }
    if (tntSourcesCandidate !== undefined && tntSourcesOwnerId !== undefined) {
      changes.push({ ownerId: tntSourcesOwnerId, state: tntSourcesCandidate })
    }

    yield* commit.tntService.commitDetonation({ id: outcome.id, planRevision: outcome.planRevision }, changes)

    if (loot._tag === 'Unsupported') yield* recordMobRuleIssues(state, 'MobDrop', loot.issues)
    if (casualtyExperience._tag === 'Unsupported') {
      yield* recordMobRuleIssues(state, 'MobExperience', casualtyExperience.issues)
    }
    yield* Ref.set(state.rollSeed, casualtyExperience.seed)
    if (loot.drops.length > 0) yield* Ref.update(state.mobDrops, (pending) => [...pending, ...loot.drops])
    if (casualtyExperience.experience.length > 0) {
      yield* Ref.update(state.mobExperience, (pending) => [...pending, ...casualtyExperience.experience])
    }
    if (playerDamage !== undefined) yield* Ref.update(state.playerDamages, (pending) => [...pending, playerDamage])
    const disturbed = outcome.explosion.destroyedBlocks.map(({ x, y, z }) => blockPositionKeyOf(blockPosition(
      Result.getOrThrow(BlockAxis.result(x)),
      Result.getOrThrow(BlockAxis.result(y)),
      Result.getOrThrow(BlockAxis.result(z)),
    )))
    if (disturbed.length > 0) yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbed))
  }
})

const runMobSimulation = (
  context: GameplayStageContext,
  dt: DeltaTimeSecs,
): Effect.Effect<undefined, unknown> => Effect.gen(function* () {
  const { state, store, commit } = context
  if (context.options.mobSimulation === false) return
  if (commit === undefined) {
    yield* unsupportedMobSimulation(state, 'WorldCommitCoordinatorUnavailable')
    return
  }
  if (commit.entitiesOwnerId === undefined) {
    yield* unsupportedMobSimulation(state, 'EntityRosterOwnerUnavailable')
    return
  }

  const entitySnapshot = yield* commit.coordinator.snapshot(
    commit.entitiesOwnerId,
    GameplayEntityRosterSchema,
  )
  const playerSnapshot = yield* commit.coordinator.snapshot(
    commit.playerOwnerId,
    PlayerServiceSnapshotSchema,
  )
  if (entitySnapshot.revision !== playerSnapshot.revision) {
    return yield* Effect.fail(new WorldRevisionConflict({
      expected: entitySnapshot.revision,
      actual: playerSnapshot.revision,
    }))
  }
  const expectedRevision = entitySnapshot.revision
  const playerPosition = position(
    PositionAxis(playerSnapshot.state.pose.feetPosition.x),
    PositionAxis(playerSnapshot.state.pose.feetPosition.y),
    PositionAxis(playerSnapshot.state.pose.feetPosition.z),
  )
  const seed = yield* Ref.get(state.rollSeed)
  // Spawn cadence assumes the host runs `entities` once per simulation tick.
  // W5 HW7 adds the fixed-step loop; count this stage pass, never frame dt.
  // `entities` runs before `fluids`, which advances this counter later in the pass.
  const currentTick = (yield* Ref.get(state.tickCount)) + 1
  const stageTick = Schema.decodeUnknownSync(SimulationTickSchema)(currentTick)
  const dimension = playerSnapshot.state.pose.feetPosition.dimension
  const timeOfDay = yield* context.time.timeOfDay
  const daytime = dimension === 'overworld' && !(yield* context.time.isNight)
  const movementCoords = mobMovementChunkCoords(entitySnapshot.state, playerPosition, dimension)
  const hasMovableMob = hasMobMovementCandidates(entitySnapshot.state, dimension, playerPosition)
  const hasUndeadForDaylight = hasUndeadDaylightCandidates(entitySnapshot.state, dimension)
  let movementWindow: import('../domain/chunk-window.js').ChunkWindow | undefined = undefined
  let movementWorld: ReturnType<typeof mobMovementWorldFromChunkWindow> = undefined
  let daylightFacts: ReadonlyMap<import('@nerima-games/mc-sim').EntityId, Readonly<{ exposed: boolean; inWater: boolean }>> = new Map()
  if (hasMovableMob || hasUndeadForDaylight) {
    const coords = hasMovableMob
      ? movementCoords
      : undeadDaylightChunkCoords(entitySnapshot.state, dimension)
    movementWindow = yield* openChunkWindow(store, coords)
    if (hasMovableMob) {
      movementWorld = mobMovementWorldFromChunkWindow(movementWindow)
      if (movementWorld === undefined) return yield* Effect.fail({ _tag: 'MobMovementWorldUnavailable' })
    }
    if (hasUndeadForDaylight) {
      // A stopped undead still burns or extinguishes when SM3 has no movement work.
      daylightFacts = yield* undeadDaylightFacts(
        entitySnapshot.state,
        movementWindow,
        store,
        daytime,
        dimension,
      )
    }
  }
  const sweep = planMobRosterSweep(entitySnapshot.state, {
    target: playerPosition,
    dt,
    undeadDaylight: daylightFacts,
  }, RandomSeed(seed))
  const teleported = yield* planEndermanTeleportRoster(
    sweep.roster,
    store,
    sweep.teleports,
  )
  const movement = movementWorld === undefined
    ? Result.succeed({ roster: teleported })
    : planMobMovementRoster(teleported, playerPosition, movementWorld, stageTick, dimension)
  if (Result.isFailure(movement)) return yield* Effect.fail(movement.failure)
  const blast = planMobBlastRoster(movement.success.roster, sweep.blasts, stageTick)
  const undeadBurnHits: ReadonlyArray<MobDamageHit> = blast.roster.entities.flatMap((entity) => {
    if (entity.kind !== 'zombie' && entity.kind !== 'skeleton') return []
    const behaviour = isHostileMobSnapshot(entity.behaviour) ? entity.behaviour.behaviour : entity.behaviour
    if (behaviour?._tag !== 'EcosystemMob' || behaviour.burningTicks === 0 || behaviour.burningTicks % 20 !== 0) return []
    return [{ id: entity.id, damage: { amount: 1, cause: 'on_fire' }, burning: true }]
  })
  const undeadBurning = planMobDamageRoster(blast.roster, undeadBurnHits, stageTick)
  const mobCasualties = [...blast.casualties, ...undeadBurning.casualties]
  const offeredAttempts = yield* Ref.get(state.spawnAttempts)
  const difficulty = (yield* state.survivalHunger.snapshot).difficulty
  const lastHostileSpawnTick = yield* Ref.get(state.lastHostileSpawnTick)
  const intervalElapsed = yield* Effect.fromResult(
    hostileSpawnSearchDue(stageTick, lastHostileSpawnTick, difficulty),
  )
  const hostileSearchDue = difficulty !== 'peaceful' && intervalElapsed
  const casualtyDrops = rollCasualtyDrops(mobCasualties, sweep.seed)
  const casualtyExperience = rollCasualtyExperience(mobCasualties, casualtyDrops.seed)
  let searchedAttempts: ReadonlyArray<MobSpawnAttempt> = NO_ATTEMPTS
  let nextRollSeed = casualtyExperience.seed
  const passiveInitialSpawnPending = yield* Ref.get(state.passiveInitialSpawnPending)
  const lastPassiveSpawnTick = yield* Ref.get(state.lastPassiveSpawnTick)
  const passiveSearchDue = dimension === 'overworld' &&
    !hostileSpawnsAllowed(timeOfDay) &&
    (passiveInitialSpawnPending || currentTick - lastPassiveSpawnTick >= PASSIVE_SPAWN_INTERVAL_TICKS)
  if (hostileSearchDue) {
    const found = yield* searchSpawnCandidates(
      store,
      playerPosition,
      timeOfDay,
      RandomSeed(casualtyExperience.seed),
      dimension,
      'hostile',
    )
    searchedAttempts = found.attempts.slice(0, HOSTILE_SPAWN_BATCH_SIZE)
    nextRollSeed = found.seed
  }
  if (passiveSearchDue) {
    const found = yield* searchSpawnCandidates(
      store,
      playerPosition,
      timeOfDay,
      RandomSeed(nextRollSeed),
      dimension,
      'passive',
    )
    nextRollSeed = found.seed
    searchedAttempts = searchedAttempts.length === 0
      ? found.attempts.slice(0, PASSIVE_SPAWN_BATCH_SIZE)
      : [...searchedAttempts, ...found.attempts.slice(0, PASSIVE_SPAWN_BATCH_SIZE)]
  }
  const attempts = offeredAttempts.length === 0
    ? searchedAttempts
    : searchedAttempts.length === 0
      ? offeredAttempts
      : [...offeredAttempts, ...searchedAttempts]
  const spawned = planSpawnAttemptsOnRoster(undeadBurning.roster, attempts, difficulty)
  if (Result.isFailure(spawned)) return yield* Effect.fail(spawned.failure)

  const damageTick = Schema.decodeUnknownSync(SimulationTickSchema)(yield* Ref.get(state.tickCount))
  const contact = yield* Effect.fromResult(resolveHostileContacts(
    spawned.success.roster.entities,
    playerPosition,
    damageTick,
    yield* Ref.get(state.hostileContactCooldowns),
    difficulty,
  ))
  const playerBlasts = resolvePlayerBlastDamage(sweep.blasts, playerPosition, difficulty)
  type HostileDamageEvent = Extract<PlayerDamageEvent, { readonly _tag: 'HostileContact' | 'Explosion' }>
  type HostileDamageInput = Readonly<{
    event: HostileDamageEvent
    attackKind: 'melee' | 'projectile' | 'explosion'
    difficulty: typeof difficulty
  }>
  const damageInputs: ReadonlyArray<HostileDamageInput> = [
    ...sweep.attacks.filter(({ mode }) => mode === 'melee').map((attack) => ({
      event: {
        _tag: 'HostileContact' as const,
        source: attack.source,
        kind: attack.attackerKind,
        at: attack.at,
        damage: { amount: attack.damage, cause: 'mob' as const },
      },
      attackKind: attack.mode,
      difficulty,
    })),
    // Contact and blast resolvers already apply the selected difficulty. Their
    // events still pass through shield and hurt resistance without scaling twice.
    ...contact.damages.map((event) => ({
      event,
      attackKind: 'melee' as const,
      difficulty: 'normal' as const,
    })),
    ...playerBlasts.map((event) => ({
      event,
      attackKind: 'explosion' as const,
      difficulty: 'normal' as const,
    })),
  ]
  const damages = damageInputs.map(({ event }) => event)
  const pendingShieldBlocking = yield* Ref.get(state.pendingShieldBlocking)
  let shieldState = yield* Ref.get(state.shieldBlocking)
  let damageImmunityState = yield* Ref.get(state.damageImmunity)
  const combatPose = {
    feetPosition: {
      x: playerSnapshot.state.pose.feetPosition.x,
      y: playerSnapshot.state.pose.feetPosition.y,
      z: playerSnapshot.state.pose.feetPosition.z,
    },
    yawRadians: playerSnapshot.state.pose.yawRadians,
    pitchRadians: playerSnapshot.state.pose.pitchRadians,
  }
  let storage: PlayerStorage | undefined
  let storageSnapshot: Readonly<{ revision: number; state: PlayerStorage }> | undefined
  let storageCandidate: PlayerStorage | undefined
  let vitalsCandidate: { readonly vitals: import('@nerima-games/mc-sim').Vitals } | undefined
  let resolvedDamages: ReadonlyArray<PlayerDamageEvent> = []
  if (damages.length > 0 || pendingShieldBlocking.length > 0) {
    if (
      commit.playerStorageOwnerId === undefined ||
      (damages.length > 0 && commit.vitalsOwnerId === undefined)
    ) {
      yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
      return
    }
    storageSnapshot = yield* commit.coordinator.snapshot(
      commit.playerStorageOwnerId,
      PlayerStorageSnapshotSchema,
    )
    if (storageSnapshot.revision !== expectedRevision) {
      return yield* Effect.fail(new WorldRevisionConflict({
        expected: expectedRevision,
        actual: storageSnapshot.revision,
      }))
    }
    storage = storageSnapshot.state

    const hasShield = () => storage?.equipment.slots.offhand?.item === 'shield'
    if (!hasShield()) shieldState = null
    for (const intent of pendingShieldBlocking) {
      if (intent.actor !== PLAYER_BLAST_ENTITY_ID) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player',
          error: { _tag: 'ShieldBlockingPreparation', reason: 'invalid-authoritative-state' },
        })
        continue
      }
      const prepared = prepareShieldBlocking(intent, {
        tick: damageTick,
        dimension: playerSnapshot.state.pose.feetPosition.dimension,
        pose: combatPose,
        hasShield: hasShield(),
        current: shieldState,
      })
      if (Result.isFailure(prepared)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player',
          error: { _tag: 'ShieldBlockingPreparation', reason: prepared.failure },
        })
        continue
      }
      shieldState = prepared.success.blocking && prepared.success.raisedAt !== null
        ? { actor: prepared.success.actor, raisedAt: prepared.success.raisedAt }
        : null
    }

    const vitalsSnapshot = damages.length === 0
      ? undefined
      : yield* commit.coordinator.snapshot(
        commit.vitalsOwnerId!,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
    if (vitalsSnapshot !== undefined && vitalsSnapshot.revision !== expectedRevision) {
      return yield* Effect.fail(new WorldRevisionConflict({
        expected: expectedRevision,
        actual: vitalsSnapshot.revision,
      }))
    }
    let vitals = vitalsSnapshot?.state.vitals
    const applied: PlayerDamageEvent[] = []
    if (storage !== undefined) {
      for (const { event, attackKind, difficulty: attackDifficulty } of damageInputs) {
        const hasEquippedShield = hasShield()
        if (!hasEquippedShield) shieldState = null
        const intent = {
          _tag: 'SetShieldBlocking' as const,
          actor: PLAYER_BLAST_ENTITY_ID,
          blocking: shieldState !== null,
        }
        const hostileAttackInput = {
          tick: damageTick,
          dimension: playerSnapshot.state.pose.feetPosition.dimension,
          pose: combatPose,
          hasShield: hasEquippedShield,
          currentShield: shieldState,
          incoming: {
            attacker: event.source,
            attackerPosition: Schema.decodeUnknownSync(WorldPositionSchema)({
              dimension: playerSnapshot.state.pose.feetPosition.dimension,
              ...event.at,
            }),
            kind: attackKind,
            amount: event.damage.amount,
          },
          difficulty: attackDifficulty,
          damageState: damageImmunityState,
        }
        const prepared = yield* Effect.fromResult(prepareHostileAttack(intent, hostileAttackInput))
        shieldState = prepared.shield.blocking && prepared.shield.raisedAt !== null
          ? { actor: prepared.shield.actor, raisedAt: prepared.shield.raisedAt }
          : null
        damageImmunityState = prepared.damageState

        if (prepared.shield.durabilityDamage > 0) {
          storage = damageAt(
            storage,
            { _tag: 'Equipment', slot: 'offhand' },
            prepared.shield.durabilityDamage,
          ).storage
          if (!hasShield()) shieldState = null
        }
        if (prepared.appliedAmount === 0) continue

        const armor = yield* Effect.fromResult(prepareArmorHit(storage.equipment, {
          ...event.damage,
          amount: prepared.appliedAmount,
        }))
        const amount = yield* Effect.fromResult(DamageAmount.result(armor.damage.amount))
        const cause = yield* Effect.fromResult(DamageCause.result(armor.damage.cause))
        vitals = applyVitalsDamage(vitals!, { amount, cause })
        for (const slot of armor.wornSlots) {
          const worn = damageAt(storage, { _tag: 'Equipment', slot }, armor.durabilityWear)
          storage = worn.storage
        }
        applied.push({ ...event, damage: armor.damage })
      }
    }
    resolvedDamages = applied
    if (storageSnapshot !== undefined && storage !== undefined && !Equal.equals(storageSnapshot.state, storage)) {
      storageCandidate = storage
    }
    if (vitalsSnapshot !== undefined && vitals !== undefined && !Equal.equals(vitalsSnapshot.state.vitals, vitals)) {
      vitalsCandidate = { vitals }
    }
  }

  let droppedCandidate: DroppedItemOwnerSnapshot | undefined
  if (casualtyDrops.drops.length > 0) {
    if (commit.droppedItemsOwnerId === undefined) {
      yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
      return
    }
    const droppedSnapshot = yield* commit.coordinator.snapshot(
      commit.droppedItemsOwnerId,
      DroppedItemOwnerSnapshotSchema,
    )
    if (droppedSnapshot.revision !== expectedRevision) {
      return yield* Effect.fail(new WorldRevisionConflict({
        expected: expectedRevision,
        actual: droppedSnapshot.revision,
      }))
    }
    const drops: ReadonlyArray<DroppedItemSpawn> = casualtyDrops.drops.map(({ item, count, at }) => ({ item, count, at }))
    droppedCandidate = yield* Effect.fromResult(
      appendDroppedItemSpawns(droppedSnapshot.state, drops, expectedRevision),
    )
  }

  const blockEdits = new Map<string, { readonly position: ReturnType<typeof blockPosition>; readonly block: typeof AIR_BLOCK_ID }>()
  const disturbedKeys: BlockPositionKey[] = []
  for (const blastEvent of sweep.blasts) {
    const power = Result.getOrUndefined(BlockBlastResistance.result(blastEvent.explosion.power))
    const x = Result.getOrUndefined(BlockAxis.result(Math.floor(blastEvent.at.x)))
    const y = Result.getOrUndefined(BlockAxis.result(Math.floor(blastEvent.at.y)))
    const z = Result.getOrUndefined(BlockAxis.result(Math.floor(blastEvent.at.z)))
    if (power === undefined || x === undefined || y === undefined || z === undefined) continue
    for (const cell of craterCells(blockPosition(x, y, z), blastEvent.explosion.power)) {
      const reading = yield* store.getBlock(cell)
      if (
        reading._tag !== 'Block' ||
        reading.block === AIR_BLOCK_ID ||
        Result.getOrUndefined(resistsExplosion(reading.block, power)) !== false
      ) continue
      const key = blockPositionKeyOf(cell)
      if (blockEdits.has(key)) continue
      blockEdits.set(key, { position: cell, block: AIR_BLOCK_ID })
      disturbedKeys.push(key)
    }
  }
  const edits = [...blockEdits.values()]
  const dimensionRevision = yield* commit.coordinator.dimensionRevision(dimension)
  const expectedDimensions = edits.length === 0
    ? []
    : [{ dimension, expectedRevision: dimensionRevision }]
  const entityCandidate = restoreGameplayEntityMetadata(
    spawned.success.roster,
    undeadBurning.roster,
    playerSnapshot.state.pose.feetPosition.dimension,
  )
  const changes: ReplicatedOwnerCandidate[] = []
  if (!Equal.equals(entitySnapshot.state, entityCandidate)) {
    changes.push({
      ownerId: Option.getOrThrow(Option.fromNullishOr(commit.entitiesOwnerId)),
      state: entityCandidate,
    })
  }
  if (droppedCandidate !== undefined) {
    const droppedItemsOwnerId = commit.droppedItemsOwnerId
    changes.push({
      ownerId: Option.getOrThrow(Option.fromNullishOr(droppedItemsOwnerId)),
      state: droppedCandidate,
    })
  }
  if (storageCandidate !== undefined) {
    changes.push({ ownerId: commit.playerStorageOwnerId, state: storageCandidate })
  }
  if (vitalsCandidate !== undefined) {
    const vitalsOwnerId = commit.vitalsOwnerId
    changes.push({
      ownerId: Option.getOrThrow(Option.fromNullishOr(vitalsOwnerId)),
      state: vitalsCandidate,
    })
  }
  let blockWrite: WorldWriteBatch | undefined
  if (edits.length > 0) {
    blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
      world: commit.coordinator.worldId,
      expectedWorldRevision: expectedRevision,
      dimension,
      expectedDimensionRevision: dimensionRevision,
      edits,
    })
  }
  if (changes.length > 0 || blockWrite !== undefined) {
    const request = {
      expectedRevision,
      expectedDimensions,
      changes,
      ...(blockWrite === undefined ? {} : { blockWrite }),
    }
    yield* commit.coordinator.commit(request)
  }

  const projectileStep = yield* launchAndStepMobProjectiles(
    context,
    sweep.attacks,
    entityCandidate,
    playerPosition,
    dimension,
    stageTick,
    movementWindow,
    store,
    movementCoords,
  )
  const projectileResolution = yield* resolveMobProjectileImpacts(
    context,
    projectileStep.impacts,
    projectileStep.retiredIds,
    dimension,
    stageTick,
    difficulty,
    nextRollSeed,
    shieldState,
    damageImmunityState,
  )
  resolvedDamages = [...resolvedDamages, ...projectileResolution.playerDamages]
  shieldState = projectileResolution.shield
  damageImmunityState = projectileResolution.immunity
  nextRollSeed = projectileResolution.seed
  if (projectileResolution.ignitions.length > 0) {
    yield* Ref.update(state.fireLifecycle, (current) => {
      const actors = new Map((current.burningActors ?? []).map((actor) => [actor.id, actor]))
      for (const ignition of projectileResolution.ignitions) {
        const previous = actors.get(ignition.id)
        actors.set(ignition.id, {
          ...ignition,
          remainingTicks: Math.max(previous?.remainingTicks ?? 0, ignition.remainingTicks),
          damageCooldownTicks: previous?.damageCooldownTicks ?? ignition.damageCooldownTicks,
        })
      }
      return { ...current, burningActors: [...actors.values()].sort((a, b) => a.id.localeCompare(b.id)) }
    })
  }

  if (casualtyDrops._tag === 'Unsupported') {
    yield* recordMobRuleIssues(state, 'MobDrop', casualtyDrops.issues)
  }
  if (casualtyExperience._tag === 'Unsupported') {
    yield* recordMobRuleIssues(state, 'MobExperience', casualtyExperience.issues)
  }

  // Local cursors and output queues move only after the replicated candidate
  // has committed. Ref updates are synchronous and append to any newly queued work.
  yield* Ref.set(state.rollSeed, nextRollSeed)
  if (hostileSearchDue) yield* Ref.set(state.lastHostileSpawnTick, stageTick)
  if (passiveSearchDue) {
    yield* Ref.set(state.lastPassiveSpawnTick, currentTick)
    yield* Ref.set(state.passiveInitialSpawnPending, false)
  }
  yield* Ref.set(state.hostileContactCooldowns, contact.cooldowns)
  yield* Ref.set(state.shieldBlocking, shieldState)
  yield* Ref.set(state.damageImmunity, damageImmunityState)
  if (pendingShieldBlocking.length > 0) {
    yield* Ref.update(state.pendingShieldBlocking, (pending) => pending.slice(pendingShieldBlocking.length))
  }
  if (offeredAttempts.length > 0) {
    yield* Ref.update(state.spawnAttempts, (pending) => pending.slice(offeredAttempts.length))
  }
  if (casualtyDrops.drops.length > 0) {
    yield* Ref.update(state.mobDrops, (pending) => [...pending, ...casualtyDrops.drops])
  }
  if (projectileResolution.drops.length > 0) {
    yield* Ref.update(state.mobDrops, (pending) => [...pending, ...projectileResolution.drops])
  }
  if (casualtyExperience.experience.length > 0 || projectileResolution.experience.length > 0) {
    yield* Ref.update(state.mobExperience, (pending) => [
      ...pending,
      ...casualtyExperience.experience,
      ...projectileResolution.experience,
    ])
  }
  if (resolvedDamages.length > 0) {
    yield* Ref.update(state.playerDamages, (pending) => [...pending, ...resolvedDamages])
  }
  if (disturbedKeys.length > 0) {
    yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbedKeys))
  }
})

export const makeEntitiesStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, commit } = context
  return {
    id: GAMEPLAY_STAGE_IDS.entities,
    after: [GAMEPLAY_STAGE_IDS.survivalHunger],
    // Owner-backed pickups, mob simulation, and TNT detonation run before the
    // deferred falling-block work.
    run: (dt) =>
      Effect.orDie(Effect.gen(function* () {
        const pickupRequests = yield* Ref.getAndSet(state.pendingDroppedItemPickups, [])
        const pickupExecutions: Array<DroppedItemPickupExecution> = []
        const retryPickups: Array<(typeof pickupRequests)[number]> = []
        for (const request of pickupRequests) {
          if (commit === undefined) {
            pickupExecutions.push({
              request,
              outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' },
            } as const)
            continue
          }
          if (commit.playerStorageOwnerId === undefined || commit.droppedItemsOwnerId === undefined) {
            pickupExecutions.push({
              request,
              outcome: { _tag: 'Unsupported', reason: 'OwnerRegistrationUnavailable' },
            } as const)
            continue
          }
          const owners = {
            playerStorage: commit.playerStorageOwnerId,
            droppedItems: commit.droppedItemsOwnerId,
          }
          const snapshots = yield* Effect.result(Effect.all([
            commit.coordinator.snapshot(owners.playerStorage, PlayerStorageSnapshotSchema),
            commit.coordinator.snapshot(owners.droppedItems, DroppedItemOwnerSnapshotSchema),
          ]))
          if (Result.isFailure(snapshots)) {
            pickupExecutions.push({ request, outcome: { _tag: 'Failed', error: snapshots.failure } as const })
            continue
          }
          const [storageSnapshot, droppedItemsSnapshot] = snapshots.success
          if (storageSnapshot.revision !== droppedItemsSnapshot.revision) {
            retryPickups.push(request)
            continue
          }
          const planned = yield* planDroppedItemPickup(
            request,
            storageSnapshot.state,
            droppedItemsSnapshot.state,
          )
          if (planned.planned.length === 0) {
            pickupExecutions.push({
              request,
              outcome: { _tag: 'Completed', result: [] } as const,
            })
            continue
          }
          const committed = yield* Effect.result(commit.coordinator.commit({
            expectedRevision: storageSnapshot.revision,
            expectedDimensions: [],
            changes: [
              { ownerId: owners.playerStorage, state: planned.playerStorage },
              { ownerId: owners.droppedItems, state: planned.droppedItems },
            ],
          }))
          if (Result.isFailure(committed)) {
            retryPickups.push(request)
            continue
          }
          const result = yield* droppedItemPickupResultAfterCommit(planned, planned.droppedItems)
          pickupExecutions.push({ request, outcome: { _tag: 'Completed', result } as const })
        }
        if (retryPickups.length > 0) {
          yield* Ref.update(state.pendingDroppedItemPickups, (pending) => [
            ...retryPickups,
            ...pending,
          ])
        }
        if (pickupExecutions.length > 0) {
          yield* Ref.update(state.droppedItemPickupExecutions, (items) => [
            ...items,
            ...pickupExecutions,
          ])
        }

        const absorptionRequests = yield* Ref.getAndSet(state.pendingExperienceOrbAbsorptions, [])
        const absorptionExecutions: Array<ExperienceOrbAbsorptionExecution> = []
        const retryAbsorptions: Array<(typeof absorptionRequests)[number]> = []
        for (const request of absorptionRequests) {
          if (commit === undefined) {
            absorptionExecutions.push({
              request,
              outcome: { _tag: 'Unsupported', reason: 'WorldCommitCoordinatorUnavailable' },
            } as const)
            continue
          }
          if (commit.vitalsOwnerId === undefined || commit.experienceOrbsOwnerId === undefined) {
            absorptionExecutions.push({
              request,
              outcome: { _tag: 'Unsupported', reason: 'OwnerRegistrationUnavailable' },
            } as const)
            continue
          }
          const owners = {
            vitals: commit.vitalsOwnerId,
            orbs: commit.experienceOrbsOwnerId,
          }
          const snapshots = yield* Effect.result(Effect.all([
            commit.coordinator.snapshot(owners.vitals, ExperienceOrbVitalsOwnerSnapshotSchema),
            commit.coordinator.snapshot(owners.orbs, ExperienceOrbOwnerSnapshotSchema),
          ]))
          if (Result.isFailure(snapshots)) {
            absorptionExecutions.push({ request, outcome: { _tag: 'Failed', error: snapshots.failure } as const })
            continue
          }
          const [vitalsSnapshot, orbsSnapshot] = snapshots.success
          if (vitalsSnapshot.revision !== orbsSnapshot.revision) {
            retryAbsorptions.push(request)
            continue
          }
          const planned = yield* Effect.result(planExperienceOrbAbsorption(
            request,
            vitalsSnapshot.state,
            orbsSnapshot.state,
          ))
          if (Result.isFailure(planned)) {
            absorptionExecutions.push({ request, outcome: { _tag: 'Failed', error: planned.failure } as const })
            continue
          }
          const committed = yield* Effect.result(commit.coordinator.commit({
            expectedRevision: vitalsSnapshot.revision,
            expectedDimensions: [],
            changes: [
              { ownerId: owners.vitals, state: planned.success.vitals },
              { ownerId: owners.orbs, state: planned.success.orbs },
            ],
          }))
          if (Result.isFailure(committed)) {
            retryAbsorptions.push(request)
            continue
          }
          const result = yield* experienceOrbAbsorptionResultAfterCommit(
            planned.success,
            planned.success.vitals,
            planned.success.orbs,
            owners,
          )
          absorptionExecutions.push({ request, outcome: { _tag: 'Completed', result } as const })
        }
        if (retryAbsorptions.length > 0) {
          yield* Ref.update(state.pendingExperienceOrbAbsorptions, (pending) => [
            ...retryAbsorptions,
            ...pending,
          ])
        }
        if (absorptionExecutions.length > 0) {
          yield* Ref.update(state.experienceOrbAbsorptionExecutions, (items) => [
            ...items,
            ...absorptionExecutions,
          ])
        }

        yield* runTntSimulation(context, dt)
        yield* runMobSimulation(context, dt)

        // ---- falling blocks ------------------------------------------------
        //
        // `Ref.modify` rather than get-then-set: plan.md §3.8 lists TOCTOU on a
        // Ref among the reference's recurring Effect-level mistakes.
        // Read-modify-write as two steps is a race the moment anything else
        // forks — and something else always does, because `disturb` is called
        // by every rule that writes a block, including the crater above.
        const batch = yield* Ref.modify(state.fallingBlocks, (queue) => {
          const { batch: taken, rest } = takeBatch(queue)
          return [taken, rest] as const
        })

        // An idle tick stops HERE, without touching the store. This is the
        // whole of DN-GP-1: the reference implementation read ~7M blocks at
        // this point whether or not anything had moved. The mob half above is
        // held to the same standard by the same test — an idle frame's sweep
        // returns the roster it was given, hands every mob the SAME step object,
        // and makes no store call at all.
        if (batch.length === 0) {
          return
        }

        const { destinations } = yield* applyFallingBlocks(store, batch)

        // `update`, not `set`: the store writes above may have caused other
        // rules to disturb positions while this tick was running, and a `set`
        // would erase them.
        if (destinations.length > 0) {
          yield* Ref.update(state.fallingBlocks, (queue) => settled(queue, destinations))
        }
      })),
  }
}
