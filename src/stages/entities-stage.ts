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
  recordGameplayStageFailureDeduplicated,
  recordGameplayUnsupportedOperation,
  recordMobRuleIssues,
  rollCasualtyExperience,
  rollAt,
  searchSpawnCandidates,
  settled,
  takeBatch,
  drawRolls,
} from './registration-core.js'
import { Equal, Option, Result, Schema } from 'effect'
import {
  AIR_BLOCK_ID,
  BlockAxis,
  BlockBlastResistance,
  InterpolationFraction,
  PositionAxis,
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
  type DeltaTimeSecs,
  type InterpolationFraction as InterpolationFractionValue,
  type BlockPositionKey,
  type Position,
  type WorldWriteBatch,
} from '@nerima-games/mc-kernel'
import {
  DamageAmount,
  DamageCause,
  EntityId,
  PlayerServiceSnapshotSchema,
  PlayerStorageSnapshotSchema,
  ExperienceDelta,
  TntServiceSnapshotSchema,
  WorldRevisionConflict,
  addExperience,
  applyDamage as applyVitalsDamage,
  damageAt,
  type ReplicatedOwnerCandidate,
  type PlayerStorage,
} from '@nerima-games/mc-sim'
import type { ExplosionBlock, ExplosionBlockReader } from '@nerima-games/mc-sim'
import { craterCells } from '../domain/interactions/explosion-crater.js'
import {
  appendDroppedItemSpawns,
  DroppedItemOwnerSnapshotSchema,
  planDroppedItemPickup,
  type DroppedItemSpawn,
  type DroppedItemOwnerSnapshot,
} from '../domain/entities/dropped-item.js'
import {
  ExperienceOrbOwnerSnapshotSchema,
  ExperienceOrbVitalsOwnerSnapshotSchema,
  canCollectExperienceOrbAtValidatedTick,
  experienceOrbAbsorptionResultAfterCommit,
  hasExperienceOrbExpiredAtValidatedTick,
  mergeSameValueExperienceOrbStacks,
  planExperienceOrbAbsorption,
  splitExperienceOrbReward,
  type ExperienceOrbAbsorptionContext,
  type ExperienceOrbValue,
  type ExperienceOrbRecord,
  type ExperienceOrbVitalsOwnerSnapshot,
} from '../domain/entities/xp-orb.js'
import {
  isExperienceOrbWithinAttractionRangeForPositions,
  pullExperienceOrbTowardPlayerForPositions,
} from '../domain/entities/xp-orb-position.js'
import {
  durabilityWearWithEnchantments,
  enchantmentLevel,
  mendOneItemFromValidatedExperience,
  thornsRetaliationChance,
  type MendingExperiencePoints,
  type EnchantmentSource,
} from '../domain/enchantment.js'
import {
  planEndermanTeleportRoster,
  planMobBlastRoster,
  planMobExplosionRoster,
  planMobRosterSweep,
  planMobDamageRoster,
  planSpawnAttemptsOnRoster,
  rollCasualtyDrops,
  type MobDamageHit,
  type MobExplosionHit,
  type MobSpawnAttempt,
} from '../domain/entities/mob-frame.js'
import {
  resolveHostileContacts,
  prepareHostileAttack,
  prepareShieldBlocking,
  resolvePlayerBlastDamage,
  type PlayerDamageEvent,
} from '../domain/mob/hostile-combat.js'
import { prepareArmorHit } from '../domain/combat/armor.js'
import { disturb } from '../domain/falling-block.js'
import { TNT_EXPLOSION_POWER, type Explosion } from '../domain/mob/explosion.js'
import { PRIMED_TNT_KIND } from '../domain/entities/mob-frame.js'
import { hostileSpawnSearchDue } from '../domain/mob/hostile-spawn.js'
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
type ExperienceOrbEncodedPosition = Readonly<{
  dimension: NonNullable<ExperienceOrbRecord['position']>['dimension']
  x: number
  y: number
  z: number
}>
type ExperienceOrbRecordForCommit = Omit<ExperienceOrbRecord, 'position'> & Readonly<{
  position?: ExperienceOrbRecord['position'] | ExperienceOrbEncodedPosition | undefined
}>

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

const damageEquipmentWithUnbreaking = (
  storage: PlayerStorage,
  slot: keyof PlayerStorage['equipment']['slots'],
  requestedWear: number,
  seed: number,
  itemKind: 'tool' | 'armor',
): Readonly<{ storage: PlayerStorage; seed: number }> => {
  const equipped = storage.equipment.slots[slot]
  // Thorns snapshots the triggering piece before ordinary armor wear can break it.
  if (equipped === null) return { storage, seed }
  const enchantments: EnchantmentSource = equipped.components?.enchantments ?? {}
  const unbreaking = enchantmentLevel(enchantments, 'unbreaking')
  const rolls = unbreaking > 0 ? drawRolls(seed, requestedWear) : undefined
  const wear = durabilityWearWithEnchantments(
    requestedWear,
    enchantments,
    rolls?.rolls ?? [],
    itemKind,
  )
  return {
    storage: wear === 0
      ? storage
      : damageAt(storage, { _tag: 'Equipment', slot }, wear).storage,
    seed: rolls?.seed ?? seed,
  }
}

const damageArmorWithUnbreaking = (
  storage: PlayerStorage,
  slots: ReadonlyArray<'head' | 'chest' | 'legs' | 'feet'>,
  requestedWear: number,
  seed: number,
): Readonly<{ storage: PlayerStorage; seed: number }> => {
  let nextStorage = storage
  let nextSeed = seed
  for (const slot of slots) {
    const result = damageEquipmentWithUnbreaking(nextStorage, slot, requestedWear, nextSeed, 'armor')
    nextStorage = result.storage
    nextSeed = result.seed
  }
  return { storage: nextStorage, seed: nextSeed }
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

  const tntService = commit.tntService
  const initial = yield* Effect.result(tntService.snapshot)
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
    let operation: 'OwnerSnapshot' | 'CandidateBuild' | 'WorldCommit' = 'OwnerSnapshot'
    const processed = yield* Effect.result(Effect.gen(function* () {
    const current = yield* tntService.snapshot
    const record = current.state.tnts.find((candidate) => candidate.id === id)
    if (record === undefined || record.state.kind !== 'primed') return
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
      operation = 'CandidateBuild'
      const reads = yield* explosionReadPositions(record.center)
      operation = 'OwnerSnapshot'
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

    operation = 'CandidateBuild'
    const outcome = yield* tntService.advance({
      id,
      deltaTimeSecs: dt,
      expectedRevision: current.revision,
      expectedDimensionRevision,
      radius: TNT_EXPLOSION_POWER,
      seed,
      blocks,
      entities: explosionEntities,
    })
    if (outcome._tag !== 'DetonationPlanned') return
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
    let nextRollSeed = casualtyExperience.seed
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
      operation = 'OwnerSnapshot'
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
      const modifiers = yield* Ref.get(state.playerStatusEffectModifiers)
      if (modifiers.damageTakenMultiplier > 0) {
        const armor = yield* Effect.fromResult(prepareArmorHit(
          storage.equipment,
          damageEvent.damage,
          modifiers.damageTakenMultiplier,
        ))
        const amount = yield* Effect.fromResult(DamageAmount.result(armor.damage.amount))
        const cause = yield* Effect.fromResult(DamageCause.result(armor.damage.cause))
        vitals = applyVitalsDamage(vitals, { amount, cause })
        const wear = damageArmorWithUnbreaking(storage, armor.wornSlots, armor.durabilityWear, nextRollSeed)
        storage = wear.storage
        nextRollSeed = wear.seed
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

    operation = 'WorldCommit'
    yield* tntService.commitDetonation({ id: outcome.id, planRevision: outcome.planRevision }, changes)

    if (loot._tag === 'Unsupported') yield* recordMobRuleIssues(state, 'MobDrop', loot.issues)
    if (casualtyExperience._tag === 'Unsupported') {
      yield* recordMobRuleIssues(state, 'MobExperience', casualtyExperience.issues)
    }
    yield* Ref.set(state.rollSeed, nextRollSeed)
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
    }))
    if (Result.isFailure(processed)) {
      yield* recordGameplayStageFailureDeduplicated(state, {
        _tag: 'Failed',
        operation,
        subject: 'Tnt',
        requestId: String(id),
        error: { _tag: 'GameplayStageExecutionFailure', cause: processed.failure },
      })
    }
  }
})

const runMobSimulation = (
  context: GameplayStageContext,
  dt: DeltaTimeSecs,
): Effect.Effect<undefined, Readonly<{
  operation: 'OwnerSnapshot' | 'CandidateBuild' | 'WorldCommit'
  cause: unknown
  requestId: string
}>> => {
  const { state, commit } = context
  if (context.options.mobSimulation === false) return Effect.succeed(undefined)
  if (commit === undefined) {
    return Effect.as(unsupportedMobSimulation(state, 'WorldCommitCoordinatorUnavailable'), undefined)
  }
  const entityOwnerId = commit.entitiesOwnerId
  if (entityOwnerId === undefined) {
    return Effect.as(unsupportedMobSimulation(state, 'EntityRosterOwnerUnavailable'), undefined)
  }

  let operation: 'OwnerSnapshot' | 'CandidateBuild' | 'WorldCommit' = 'OwnerSnapshot'
  return Effect.gen(function* () {
  const { store } = context

  const entitySnapshot = yield* commit.coordinator.snapshot(
    entityOwnerId,
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
  operation = 'CandidateBuild'
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
  const sweep = planMobRosterSweep(entitySnapshot.state, {
    target: playerPosition,
    dt,
  }, RandomSeed(seed))
  const teleported = yield* planEndermanTeleportRoster(
    sweep.roster,
    store,
    sweep.teleports,
  )
  const blast = planMobBlastRoster(teleported, sweep.blasts, stageTick)
  const offeredAttempts = yield* Ref.get(state.spawnAttempts)
  const difficulty = (yield* state.survivalHunger.snapshot).difficulty
  const lastHostileSpawnTick = yield* Ref.get(state.lastHostileSpawnTick)
  const dimension = playerSnapshot.state.pose.feetPosition.dimension
  let hostileSearchDue = false
  if (difficulty !== 'peaceful') {
    const intervalElapsed = hostileSpawnSearchDue(stageTick, lastHostileSpawnTick, difficulty)
    if (Result.isFailure(intervalElapsed)) {
      yield* recordGameplayStageFailureDeduplicated(state, {
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'EntityRoster',
        requestId: JSON.stringify(['hostile-spawn-search', dimension]),
        error: {
          _tag: 'GameplayStageExecutionFailure',
          cause: intervalElapsed.failure,
        },
      })
    } else {
      hostileSearchDue = intervalElapsed.success
    }
  }
  const casualtyDrops = rollCasualtyDrops(blast.casualties, sweep.seed)
  const casualtyExperience = rollCasualtyExperience(blast.casualties, casualtyDrops.seed)
  let searchedAttempts: ReadonlyArray<MobSpawnAttempt> = NO_ATTEMPTS
  let nextRollSeed = casualtyExperience.seed
  const timeOfDay = yield* context.time.timeOfDay
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
  const retrySpawnAttempts: MobSpawnAttempt[] = []
  let spawnedRoster = blast.roster
  for (const [attemptIndex, attempt] of attempts.entries()) {
    const planned = planSpawnAttemptsOnRoster(spawnedRoster, [attempt], difficulty)
    if (Result.isFailure(planned)) {
      yield* recordGameplayStageFailureDeduplicated(state, {
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'EntityRoster',
        requestId: JSON.stringify([
          'mob-spawn',
          attempt.kind,
          dimension,
          attempt.feetPosition.x,
          attempt.feetPosition.y,
          attempt.feetPosition.z,
        ]),
        error: { _tag: 'GameplayStageExecutionFailure', cause: planned.failure },
      })
      if (attemptIndex < offeredAttempts.length) retrySpawnAttempts.push(attempt)
      continue
    }
    spawnedRoster = planned.success.roster
  }

  const damageTick = Schema.decodeUnknownSync(SimulationTickSchema)(yield* Ref.get(state.tickCount))
  const previousContactCooldowns = yield* Ref.get(state.hostileContactCooldowns)
  const contactCooldowns = new Map<ReturnType<typeof EntityId>, Schema.Schema.Type<typeof SimulationTickSchema>>()
  const invalidContactIds = new Set<ReturnType<typeof EntityId>>()
  const contactDamages: Array<Extract<PlayerDamageEvent, { readonly _tag: 'HostileContact' }>> = []
  for (const [id, previousTick] of previousContactCooldowns) {
    const checked = resolveHostileContacts(
      [],
      undefined,
      damageTick,
      new Map([[id, previousTick]]),
      difficulty,
    )
    if (Result.isFailure(checked)) {
      invalidContactIds.add(id)
      yield* recordGameplayStageFailureDeduplicated(state, {
        _tag: 'Failed',
        operation: 'CandidateBuild',
        subject: 'EntityRoster',
        requestId: String(id),
        error: {
          _tag: 'GameplayStageExecutionFailure',
          cause: { _tag: 'HostileContactResolutionFailure', reason: checked.failure },
        },
      })
      continue
    }
    for (const [validId, validTick] of checked.success.cooldowns) {
      contactCooldowns.set(validId, validTick)
    }
  }
  for (const entity of spawnedRoster.entities) {
    if (invalidContactIds.has(entity.id)) continue
    const previousTick = contactCooldowns.get(entity.id)
    const entityCooldowns = previousTick === undefined
      ? new Map<ReturnType<typeof EntityId>, Schema.Schema.Type<typeof SimulationTickSchema>>()
      : new Map([[entity.id, previousTick]])
    // The first pass decoded damageTick and every cooldown retained in contactCooldowns.
    // Those are the only values that can make this resolver fail.
    const checked = Result.getOrThrow(resolveHostileContacts(
      [entity],
      playerPosition,
      damageTick,
      entityCooldowns,
      difficulty,
    ))
    contactDamages.push(...checked.damages)
    for (const [validId, validTick] of checked.cooldowns) {
      contactCooldowns.set(validId, validTick)
    }
  }
  const contact = { damages: contactDamages, cooldowns: contactCooldowns }
  const playerBlasts = resolvePlayerBlastDamage(sweep.blasts, playerPosition, difficulty)
  type HostileDamageEvent = Extract<PlayerDamageEvent, { readonly _tag: 'HostileContact' | 'Explosion' }>
  type HostileDamageInput = Readonly<{
    event: HostileDamageEvent
    attackKind: 'melee' | 'projectile' | 'explosion'
    difficulty: typeof difficulty
  }>
  const damageInputs: ReadonlyArray<HostileDamageInput> = [
    ...sweep.attacks.map((attack) => ({
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
  const thornsDamageHits: MobDamageHit[] = []
  if (damages.length > 0 || pendingShieldBlocking.length > 0) {
    if (
      commit.playerStorageOwnerId === undefined ||
      (damages.length > 0 && commit.vitalsOwnerId === undefined)
    ) {
      yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
      return
    }
    operation = 'OwnerSnapshot'
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
        yield* recordGameplayStageFailureDeduplicated(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player',
          requestId: String(intent.actor),
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
        yield* recordGameplayStageFailureDeduplicated(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'Player',
          requestId: String(intent.actor),
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
      const modifiers = yield* Ref.get(state.playerStatusEffectModifiers)
      const attemptDamage = (input: HostileDamageInput) => Effect.gen(function* () {
          const { event, attackKind, difficulty: attackDifficulty } = input
          let eventStorage = storage!
          let eventSeed = nextRollSeed
          let eventShieldState = shieldState
          let eventDamageImmunityState = damageImmunityState
          let eventVitals = vitals!
          const eventThornsDamageHits: MobDamageHit[] = []
          let appliedEvent: PlayerDamageEvent | undefined
          const hasEventShield = () => eventStorage.equipment.slots.offhand?.item === 'shield'
          const hasEquippedShield = hasEventShield()
          if (!hasEquippedShield) eventShieldState = null
          const intent = {
            _tag: 'SetShieldBlocking' as const,
            actor: PLAYER_BLAST_ENTITY_ID,
            blocking: eventShieldState !== null,
          }
          const attackerPosition = yield* Effect.fromResult(Schema.decodeUnknownResult(WorldPositionSchema)({
            dimension: playerSnapshot.state.pose.feetPosition.dimension,
            ...event.at,
          }))
          const hostileAttackInput = {
            tick: damageTick,
            dimension: playerSnapshot.state.pose.feetPosition.dimension,
            pose: combatPose,
            hasShield: hasEquippedShield,
            currentShield: eventShieldState,
            incoming: {
              attacker: event.source,
              attackerPosition,
              kind: attackKind,
              amount: event.damage.amount,
            },
            difficulty: attackDifficulty,
            damageState: eventDamageImmunityState,
          }
          const prepared = yield* Effect.fromResult(prepareHostileAttack(intent, hostileAttackInput))
          eventShieldState = prepared.shield.blocking && prepared.shield.raisedAt !== null
            ? { actor: prepared.shield.actor, raisedAt: prepared.shield.raisedAt }
            : null
          eventDamageImmunityState = prepared.damageState

          if (prepared.shield.durabilityDamage > 0) {
            const wear = damageEquipmentWithUnbreaking(
              eventStorage,
              'offhand',
              prepared.shield.durabilityDamage,
              eventSeed,
              'tool',
            )
            eventSeed = wear.seed
            eventStorage = wear.storage
            if (!hasEventShield()) eventShieldState = null
          }
          if (prepared.appliedAmount === 0 || modifiers.damageTakenMultiplier === 0) {
            return {
              storage: eventStorage,
              seed: eventSeed,
              shieldState: eventShieldState,
              damageImmunityState: eventDamageImmunityState,
              vitals: eventVitals,
              appliedEvent,
              thornsDamageHits: eventThornsDamageHits,
            }
          }

          const storageBeforeHit = eventStorage
          const thornsPieces = event._tag === 'HostileContact' &&
            spawnedRoster.entities.some(({ id }) => id === event.source)
            ? (['head', 'chest', 'legs', 'feet'] as const).flatMap((slot) => {
                const equipped = storageBeforeHit.equipment.slots[slot]
                if (equipped === null) return []
                const enchantments: EnchantmentSource = equipped.components?.enchantments ?? {}
                const chance = thornsRetaliationChance(enchantments)
                return chance > 0 ? [{ slot, chance }] : []
              })
            : []
          const armor = yield* Effect.fromResult(prepareArmorHit(eventStorage.equipment, {
            ...event.damage,
            amount: prepared.appliedAmount,
          }, modifiers.damageTakenMultiplier))
          const amount = yield* Effect.fromResult(DamageAmount.result(armor.damage.amount))
          const cause = yield* Effect.fromResult(DamageCause.result(armor.damage.cause))
          eventVitals = applyVitalsDamage(eventVitals, { amount, cause })
          const wear = damageArmorWithUnbreaking(eventStorage, armor.wornSlots, armor.durabilityWear, eventSeed)
          eventStorage = wear.storage
          eventSeed = wear.seed
          appliedEvent = { ...event, damage: armor.damage }

          if (thornsPieces.length > 0) {
            let retaliationDamage: number | undefined
            const triggeredSlots: Array<'head' | 'chest' | 'legs' | 'feet'> = []
            for (const piece of thornsPieces) {
              const chance = drawRolls(eventSeed, 1)
              eventSeed = chance.seed
              if (rollAt(chance, 0) >= piece.chance) continue
              const damage = drawRolls(eventSeed, 1)
              eventSeed = damage.seed
              retaliationDamage = Math.max(retaliationDamage ?? 0, 1 + rollAt(damage, 0) * 4)
              triggeredSlots.push(piece.slot)
            }
            for (const slot of triggeredSlots) {
              const wearResult = damageEquipmentWithUnbreaking(eventStorage, slot, 2, eventSeed, 'armor')
              eventStorage = wearResult.storage
              eventSeed = wearResult.seed
            }
            if (retaliationDamage !== undefined) {
              eventThornsDamageHits.push({
                id: event.source,
                damage: { amount: retaliationDamage, cause: 'generic' },
                killCredit: 'player',
                lastHitTick: damageTick,
              })
            }
          }
          return {
            storage: eventStorage,
            seed: eventSeed,
            shieldState: eventShieldState,
            damageImmunityState: eventDamageImmunityState,
            vitals: eventVitals,
            appliedEvent,
            thornsDamageHits: eventThornsDamageHits,
          }
        })
      for (const input of damageInputs) {
        const { event } = input
        const attempted = yield* Effect.result(attemptDamage(input))
        if (Result.isFailure(attempted)) {
          if (event._tag === 'HostileContact') contact.cooldowns.delete(event.source)
          yield* recordGameplayStageFailureDeduplicated(state, {
            _tag: 'Failed',
            operation: 'CandidateBuild',
            subject: 'Player',
            requestId: JSON.stringify(['player-damage', event._tag, event.source]),
            error: { _tag: 'GameplayStageExecutionFailure', cause: attempted.failure },
          })
          continue
        }
        storage = attempted.success.storage
        nextRollSeed = attempted.success.seed
        shieldState = attempted.success.shieldState
        damageImmunityState = attempted.success.damageImmunityState
        vitals = attempted.success.vitals
        if (attempted.success.appliedEvent !== undefined) applied.push(attempted.success.appliedEvent)
        thornsDamageHits.push(...attempted.success.thornsDamageHits)
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

  const thornsRetaliations = planMobDamageRoster(spawnedRoster, thornsDamageHits, damageTick)
  const thornsDrops = rollCasualtyDrops(thornsRetaliations.casualties, nextRollSeed)
  const thornsExperience = rollCasualtyExperience(thornsRetaliations.casualties, thornsDrops.seed)
  nextRollSeed = thornsExperience.seed
  const allMobDrops = [...casualtyDrops.drops, ...thornsDrops.drops]
  const committedMobDrops: Array<(typeof allMobDrops)[number]> = []
  const allMobExperience = [...casualtyExperience.experience, ...thornsExperience.experience]

  let droppedCandidate: DroppedItemOwnerSnapshot | undefined
  if (allMobDrops.length > 0) {
    if (commit.droppedItemsOwnerId === undefined) {
      yield* unsupportedMobSimulation(state, 'OwnerRegistrationUnavailable')
      return
    }
    operation = 'OwnerSnapshot'
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
    let candidate = droppedSnapshot.state
    for (const drop of allMobDrops) {
      const appended = appendDroppedItemSpawns(candidate, [{
        item: drop.item,
        count: drop.count,
        at: drop.at,
      }], expectedRevision)
      if (Result.isFailure(appended)) {
        yield* recordGameplayStageFailureDeduplicated(state, {
          _tag: 'Failed',
          operation: 'CandidateBuild',
          subject: 'DroppedItem',
          requestId: String(drop.source),
          error: appended.failure,
        })
        continue
      }
      candidate = appended.success
      committedMobDrops.push(drop)
    }
    if (!Equal.equals(candidate, droppedSnapshot.state)) droppedCandidate = candidate
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
  operation = 'OwnerSnapshot'
  const dimensionRevision = yield* commit.coordinator.dimensionRevision(dimension)
  const expectedDimensions = edits.length === 0
    ? []
    : [{ dimension, expectedRevision: dimensionRevision }]
  const entityCandidate = restoreGameplayEntityMetadata(
    thornsRetaliations.roster,
    blast.roster,
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
    operation = 'CandidateBuild'
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
    operation = 'WorldCommit'
    yield* commit.coordinator.commit(request)
  }

  if (casualtyDrops._tag === 'Unsupported') {
    yield* recordMobRuleIssues(state, 'MobDrop', casualtyDrops.issues)
  }
  if (casualtyExperience._tag === 'Unsupported') {
    yield* recordMobRuleIssues(state, 'MobExperience', casualtyExperience.issues)
  }
  if (thornsDrops._tag === 'Unsupported') yield* recordMobRuleIssues(state, 'MobDrop', thornsDrops.issues)

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
    yield* Ref.update(state.spawnAttempts, (pending) => [
      ...retrySpawnAttempts,
      ...pending.slice(offeredAttempts.length),
    ])
  }
  if (committedMobDrops.length > 0) {
    yield* Ref.update(state.mobDrops, (pending) => [...pending, ...committedMobDrops])
  }
  if (allMobExperience.length > 0) {
    yield* Ref.update(state.mobExperience, (pending) => [...pending, ...allMobExperience])
  }
  if (resolvedDamages.length > 0) {
    yield* Ref.update(state.playerDamages, (pending) => [...pending, ...resolvedDamages])
  }
  if (disturbedKeys.length > 0) {
    yield* Ref.update(state.fallingBlocks, (queue) => disturb(queue, disturbedKeys))
  }
  }).pipe(Effect.mapError((cause) => ({ operation, cause, requestId: String(entityOwnerId) })))
}

type PlannedMendingRepair = Readonly<{
  storage: PlayerStorage
  experienceRemaining: ExperienceOrbValue | MendingExperiencePoints
}>

const mendingCandidatesForStorage = (
  storage: PlayerStorage,
): ReadonlyArray<Parameters<typeof mendOneItemFromValidatedExperience>[0][number]> => {
  const candidates: Array<Parameters<typeof mendOneItemFromValidatedExperience>[0][number]> = []
  const mainHand = storage.inventory.slots[0]
  if (mainHand !== undefined) {
    candidates.push({
      slot: 'inventory:0',
      durability: storage.inventoryDurability[0] ?? null,
      enchantments: mainHand.components?.enchantments ?? {},
    })
  }
  for (const slot of ['head', 'chest', 'legs', 'feet', 'offhand'] as const) {
    const equipped = storage.equipment.slots[slot]
    if (equipped !== null) {
      candidates.push({
        slot: `equipment:${slot}`,
        durability: equipped.durability,
        enchantments: equipped.components?.enchantments ?? {},
      })
    }
  }
  return candidates
}

const storageAfterMendingRepair = (
  storage: PlayerStorage,
  selectedSlot: string,
  repairedDurability: NonNullable<Parameters<typeof mendOneItemFromValidatedExperience>[0][number]['durability']>,
): PlayerStorage => {
  if (selectedSlot === 'inventory:0') {
    const inventoryDurability = [...storage.inventoryDurability]
    inventoryDurability[0] = repairedDurability
    return { ...storage, inventoryDurability }
  }
  const equipmentSlot = selectedSlot.slice('equipment:'.length)
  const slot = equipmentSlot as keyof PlayerStorage['equipment']['slots']
  const equipped = storage.equipment.slots[slot]!
  return {
    ...storage,
    equipment: {
      ...storage.equipment,
      slots: {
        ...storage.equipment.slots,
        [slot]: { ...equipped, durability: repairedDurability },
      },
    },
  }
}

const planMendingRepair = (
  storage: PlayerStorage,
  orbExperience: ExperienceOrbValue,
  roll: InterpolationFractionValue,
): PlannedMendingRepair => {
  const repair = mendOneItemFromValidatedExperience(
    mendingCandidatesForStorage(storage),
    orbExperience,
    roll,
  )
  // The caller enters only after finding a damaged Mending candidate in a
  // schema-validated storage snapshot, and its roll comes from drawRolls.
  const repairedCandidate = repair.repairedCandidate!
  const repairedDurability = repairedCandidate.durability!
  return {
    storage: storageAfterMendingRepair(storage, repairedCandidate.slot, repairedDurability),
    experienceRemaining: repair.xpRemaining,
  }
}

const experienceOrbRecordsForReward = (
  existing: ReadonlyArray<ExperienceOrbRecord>,
  source: string,
  eventIndex: number,
  values: ReadonlyArray<ExperienceOrbValue>,
  at: Schema.Schema.Type<typeof WorldPositionSchema>,
  tick: Schema.Schema.Type<typeof SimulationTickSchema>,
): Result.Result<Readonly<{ records: ReadonlyArray<ExperienceOrbRecord>; changed: boolean }>, Schema.SchemaError> => {
  const next = [...existing]
  const ids = new Set(existing.map(({ id }) => id))
  let changed = false
  for (const [valueIndex, value] of values.entries()) {
    const nearbyIndex = next.findIndex((orb) =>
      orb.value === value && orb.position !== undefined &&
      orb.position.dimension === at.dimension && orb.position.x === at.x &&
      orb.position.y === at.y && orb.position.z === at.z,
    )
    if (nearbyIndex >= 0) {
      const existingOrb = next[nearbyIndex]!
      const merged = mergeSameValueExperienceOrbStacks(
        { value: existingOrb.value, count: existingOrb.count },
        { value },
      )
      if (Result.isFailure(merged)) return Result.fail(merged.failure)
      next[nearbyIndex] = { ...existingOrb, count: merged.success!.count }
      changed = true
      continue
    }
    const id = EntityId(`mx-gameplay:experience-orb/${source}/${tick}/${eventIndex}/${valueIndex}`)
    if (ids.has(id)) continue
    ids.add(id)
    next.push({ id, value, position: at, spawnedAt: tick })
    changed = true
  }
  // Existing records were decoded at the owner boundary; additions and merged counts are branded above.
  return Result.succeed({ records: next, changed })
}

const spawnQueuedExperienceOrbs = (context: GameplayStageContext): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { state, commit } = context
    const experiences = yield* Ref.get(state.mobExperience)
    if (experiences.length === 0) return
    if (commit === undefined || commit.experienceOrbsOwnerId === undefined) {
      yield* recordGameplayUnsupportedOperation(state, {
        _tag: 'Unsupported', action: 'ExperienceOrbCreation', reason: 'OwnerRegistrationUnavailable',
      })
      return
    }
    const snapshots = yield* Effect.result(Effect.all([
      commit.coordinator.snapshot(commit.playerOwnerId, PlayerServiceSnapshotSchema),
      commit.coordinator.snapshot(commit.experienceOrbsOwnerId, ExperienceOrbOwnerSnapshotSchema),
    ]))
    if (Result.isFailure(snapshots)) {
      yield* recordGameplayStageFailureDeduplicated(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
        requestId: String(commit.experienceOrbsOwnerId), error: snapshots.failure,
      })
      return
    }
    const [playerSnapshot, orbSnapshot] = snapshots.success
    if (playerSnapshot.revision !== orbSnapshot.revision) {
      yield* recordGameplayStageFailureDeduplicated(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
        requestId: String(commit.experienceOrbsOwnerId),
        error: new WorldRevisionConflict({ expected: playerSnapshot.revision, actual: orbSnapshot.revision }),
      })
      return
    }
    const tick = Schema.decodeUnknownResult(SimulationTickSchema)(yield* Ref.get(state.tickCount))
    if (Result.isFailure(tick)) {
      yield* recordGameplayStageFailureDeduplicated(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb',
        requestId: String(commit.experienceOrbsOwnerId), error: tick.failure,
      })
      return
    }
    let nextOrbs = orbSnapshot.state.orbs
    let orbRecordsChanged = false
    const failedRewards: Array<(typeof experiences)[number]> = []
    for (const [eventIndex, event] of experiences.entries()) {
      const values = splitExperienceOrbReward(event.amount)
      if (Result.isFailure(values)) {
        yield* recordGameplayStageFailureDeduplicated(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb',
          requestId: String(event.source), error: values.failure,
        })
        failedRewards.push(event)
        continue
      }
      const at = Schema.decodeUnknownResult(WorldPositionSchema)({
        dimension: event.dimension ?? playerSnapshot.state.pose.feetPosition.dimension,
        x: event.at.x,
        y: event.at.y,
        z: event.at.z,
      })
      if (Result.isFailure(at)) {
        yield* recordGameplayStageFailureDeduplicated(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb',
          requestId: String(event.source), error: at.failure,
        })
        failedRewards.push(event)
        continue
      }
      const spawned = experienceOrbRecordsForReward(
        nextOrbs,
        String(event.source),
        eventIndex,
        values.success,
        at.success,
        tick.success,
      )
      if (Result.isFailure(spawned)) {
        yield* recordGameplayStageFailureDeduplicated(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb',
          requestId: String(event.source), error: spawned.failure,
        })
        failedRewards.push(event)
        continue
      }
      nextOrbs = spawned.success.records
      orbRecordsChanged ||= spawned.success.changed
    }
    if (orbRecordsChanged) {
      const committed = yield* Effect.result(commit.coordinator.commit({
        expectedRevision: orbSnapshot.revision,
        expectedDimensions: [],
        changes: [{ ownerId: commit.experienceOrbsOwnerId, state: { orbs: nextOrbs } }],
      }))
      if (Result.isFailure(committed)) {
        yield* recordGameplayStageFailureDeduplicated(state, {
          _tag: 'Failed', operation: 'WorldCommit', subject: 'ExperienceOrb',
          requestId: String(commit.experienceOrbsOwnerId), error: committed.failure,
        })
        return
      }
    }
    yield* Ref.update(state.mobExperience, (pending) => [
      ...failedRewards,
      ...pending.slice(experiences.length),
    ])
  })

const attractExperienceOrbsAndQueuePickup = (
  state: GameplayStageContext['state'],
  commit: GameplayStageContext['commit'],
  dt: DeltaTimeSecs,
): Effect.Effect<ReadonlyArray<ExperienceOrbAbsorptionContext>> => Effect.gen(function* () {
  if (commit === undefined || commit.experienceOrbsOwnerId === undefined) return []
  const orbSnapshotResult = yield* Effect.result(commit.coordinator.snapshot(
    commit.experienceOrbsOwnerId,
    ExperienceOrbOwnerSnapshotSchema,
  ))
  if (Result.isFailure(orbSnapshotResult)) {
    yield* recordGameplayStageFailureDeduplicated(state, {
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
      requestId: String(commit.experienceOrbsOwnerId), error: orbSnapshotResult.failure,
    })
    return []
  }
  const orbSnapshot = orbSnapshotResult.success
  const tick = Schema.decodeUnknownResult(SimulationTickSchema)(yield* Ref.get(state.tickCount))
  if (Result.isFailure(tick)) {
    yield* recordGameplayStageFailureDeduplicated(state, {
      _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb',
      requestId: String(commit.experienceOrbsOwnerId), error: tick.failure,
    })
    return []
  }
  let changed = false
  const liveOrbs: ExperienceOrbRecord[] = []
  for (const orb of orbSnapshot.state.orbs) {
    const expired = hasExperienceOrbExpiredAtValidatedTick(orb.spawnedAt, tick.success)
    if (expired) changed = true
    else liveOrbs.push(orb)
  }
  if (!liveOrbs.some(({ position: orbPosition }) => orbPosition !== undefined)) {
    if (changed) {
      const committed = yield* Effect.result(commit.coordinator.commit({
        expectedRevision: orbSnapshot.revision,
        expectedDimensions: [],
        changes: [{ ownerId: commit.experienceOrbsOwnerId, state: { orbs: liveOrbs } }],
      }))
      if (Result.isFailure(committed)) {
        yield* recordGameplayStageFailureDeduplicated(state, {
          _tag: 'Failed', operation: 'WorldCommit', subject: 'ExperienceOrb',
          requestId: String(commit.experienceOrbsOwnerId), error: committed.failure,
        })
      }
    }
    return []
  }
  const playerSnapshotResult = yield* Effect.result(commit.coordinator.snapshot(
    commit.playerOwnerId,
    PlayerServiceSnapshotSchema,
  ))
  if (Result.isFailure(playerSnapshotResult)) {
    yield* recordGameplayStageFailureDeduplicated(state, {
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
      requestId: String(commit.playerOwnerId), error: playerSnapshotResult.failure,
    })
    return []
  }
  const playerSnapshot = playerSnapshotResult.success
  if (playerSnapshot.revision !== orbSnapshot.revision) {
    yield* recordGameplayStageFailureDeduplicated(state, {
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
      requestId: String(commit.experienceOrbsOwnerId),
      error: new WorldRevisionConflict({ expected: playerSnapshot.revision, actual: orbSnapshot.revision }),
    })
    return []
  }
  const playerPosition = playerSnapshot.state.pose.feetPosition
  const lastCollectedTick = yield* Ref.get(state.lastExperienceOrbPickupTick)
  const mayCollect = canCollectExperienceOrbAtValidatedTick(tick.success, lastCollectedTick ?? undefined)
  let closest: Readonly<{ orb: ExperienceOrbRecord; distanceSquared: number }> | undefined
  const nextOrbs: ExperienceOrbRecordForCommit[] = []
  for (const orb of liveOrbs) {
    if (orb.position === undefined) {
      nextOrbs.push(orb)
      continue
    }
    const inRange = isExperienceOrbWithinAttractionRangeForPositions(orb.position, playerPosition)
    if (!inRange) {
      nextOrbs.push(orb)
      continue
    }
    const pulled = pullExperienceOrbTowardPlayerForPositions(orb.position, playerPosition, dt)
    const moved = pulled.position.x !== orb.position.x || pulled.position.y !== orb.position.y ||
      pulled.position.z !== orb.position.z
    if (moved) changed = true
    const nextPosition = moved ? pulled.position : orb.position
    const nextOrb = moved ? { ...orb, position: nextPosition } : orb
    nextOrbs.push(nextOrb)
    if (pulled.withinPickupRange) {
      const distanceSquared = pulled.distanceSquared
      if (closest === undefined || distanceSquared < closest.distanceSquared) {
        closest = { orb, distanceSquared }
      }
    }
  }
  if (changed) {
    const committed = yield* Effect.result(commit.coordinator.commit({
      expectedRevision: orbSnapshot.revision,
      expectedDimensions: [],
      changes: [{ ownerId: commit.experienceOrbsOwnerId, state: { orbs: nextOrbs } }],
    }))
    if (Result.isFailure(committed)) {
      yield* recordGameplayStageFailureDeduplicated(state, {
        _tag: 'Failed', operation: 'WorldCommit', subject: 'ExperienceOrb',
        requestId: String(commit.experienceOrbsOwnerId), error: committed.failure,
      })
      return []
    }
  }
  if (!mayCollect || closest === undefined) return []
  return [{
    actor: EntityId('mx-gameplay:player-avatar'),
    orb: closest.orb.id,
    tick: tick.success,
    position: playerPosition,
  }]
})

export const makeEntitiesStage = (context: GameplayStageContext): StageRegistration => {
  const { state, store, commit } = context
  return {
    id: GAMEPLAY_STAGE_IDS.entities,
    after: [GAMEPLAY_STAGE_IDS.survivalHunger],
    // Owner-backed pickups, mob simulation, and TNT detonation run before the
    // deferred falling-block work.
    run: (dt) =>
      Effect.gen(function* () {
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
            yield* recordGameplayStageFailureDeduplicated(state, {
              _tag: 'Failed',
              operation: 'OwnerSnapshot',
              subject: 'DroppedItem',
              requestId: String(request.actor),
              error: snapshots.failure,
            })
            pickupExecutions.push({ request, outcome: { _tag: 'Failed', error: snapshots.failure } as const })
            continue
          }
          const [storageSnapshot, droppedItemsSnapshot] = snapshots.success
          if (storageSnapshot.revision !== droppedItemsSnapshot.revision) {
            retryPickups.push(request)
            continue
          }
          const plannedResult = yield* Effect.result(planDroppedItemPickup(
            request,
            storageSnapshot.state,
            droppedItemsSnapshot.state,
          ))
          if (Result.isFailure(plannedResult)) {
            yield* recordGameplayStageFailureDeduplicated(state, {
              _tag: 'Failed',
              operation: 'PlanBuild',
              subject: 'DroppedItem',
              requestId: String(request.actor),
              error: plannedResult.failure,
            })
            pickupExecutions.push({ request, outcome: { _tag: 'Failed', error: plannedResult.failure } as const })
            continue
          }
          const planned = plannedResult.success
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
          pickupExecutions.push({ request, outcome: { _tag: 'Completed', result: planned.result } as const })
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

        const queuedAbsorptions = yield* Ref.getAndSet(state.pendingExperienceOrbAbsorptions, [])
        const automaticAbsorptions = queuedAbsorptions.length === 0
          ? yield* attractExperienceOrbsAndQueuePickup(state, commit, dt)
          : []
        const queuedOrbIds = new Set(queuedAbsorptions.map(({ orb }) => orb))
        const absorptionRequests = [
          ...queuedAbsorptions,
          ...automaticAbsorptions.filter(({ orb }) => !queuedOrbIds.has(orb)),
        ]
        const automaticOrbIds = new Set(automaticAbsorptions.map(({ orb }) => orb))
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
          if (
            commit.vitalsOwnerId === undefined ||
            commit.experienceOrbsOwnerId === undefined
          ) {
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
          let operation: 'OwnerSnapshot' | 'PlanBuild' | 'CandidateBuild' | 'WorldCommit' = 'OwnerSnapshot'
          const attempted = yield* Effect.result(Effect.gen(function* () {
            const [vitalsSnapshot, orbsSnapshot] = yield* Effect.all([
              commit.coordinator.snapshot(owners.vitals, ExperienceOrbVitalsOwnerSnapshotSchema),
              commit.coordinator.snapshot(owners.orbs, ExperienceOrbOwnerSnapshotSchema),
            ])
            if (vitalsSnapshot.revision !== orbsSnapshot.revision) return { _tag: 'Retry' } as const

            const storageSnapshot = yield* commit.coordinator.snapshot(
              commit.playerStorageOwnerId,
              PlayerStorageSnapshotSchema,
            )
            if (storageSnapshot.revision !== vitalsSnapshot.revision) return { _tag: 'Retry' } as const

            operation = 'PlanBuild'
            const planned = yield* planExperienceOrbAbsorption(
              request,
              vitalsSnapshot.state,
              orbsSnapshot.state,
            )
            let experienceRemaining: ExperienceOrbValue | MendingExperiencePoints = planned.experience
            let repairedStorage: PlayerStorage | undefined
            let rollSeed: number | undefined
            const candidates = mendingCandidatesForStorage(storageSnapshot.state)
            const eligibleMending = candidates.some(({ durability, enchantments }) =>
              durability !== null &&
              durability.max > durability.current &&
              enchantmentLevel(enchantments, 'mending') > 0,
            )
            if (eligibleMending) {
              const currentSeed = yield* Ref.get(state.rollSeed)
              const rolls = drawRolls(currentSeed, 1)
              const roll = InterpolationFraction(rollAt(rolls, 0))
              operation = 'CandidateBuild'
              const repair = planMendingRepair(storageSnapshot.state, planned.experience, roll)
              experienceRemaining = repair.experienceRemaining
              repairedStorage = repair.storage
              rollSeed = rolls.seed
            }
            const experienceDelta = ExperienceDelta(experienceRemaining)
            const vitalsCandidate: ExperienceOrbVitalsOwnerSnapshot = {
              vitals: addExperience(vitalsSnapshot.state.vitals, experienceDelta),
            }
            const changes = [
              { ownerId: owners.vitals, state: vitalsCandidate },
              { ownerId: owners.orbs, state: planned.orbs },
              ...(repairedStorage === undefined || commit.playerStorageOwnerId === undefined
                ? []
                : [{ ownerId: commit.playerStorageOwnerId, state: repairedStorage }]),
            ]
            operation = 'WorldCommit'
            const committed = yield* Effect.result(commit.coordinator.commit({
              expectedRevision: vitalsSnapshot.revision,
              expectedDimensions: [],
              changes,
            }))
            if (Result.isFailure(committed)) return { _tag: 'Retry' } as const

            if (rollSeed !== undefined) yield* Ref.set(state.rollSeed, rollSeed)
            operation = 'CandidateBuild'
            const result = yield* experienceOrbAbsorptionResultAfterCommit(
              planned,
              vitalsCandidate,
              planned.orbs,
              owners,
            )
            if (automaticOrbIds.has(request.orb)) {
              yield* Ref.set(state.lastExperienceOrbPickupTick, planned.context.tick)
            }
            return { _tag: 'Completed', result } as const
          }))
          if (Result.isFailure(attempted)) {
            yield* recordGameplayStageFailureDeduplicated(state, {
              _tag: 'Failed',
              operation,
              subject: 'ExperienceOrb',
              requestId: String(request.orb),
              error: attempted.failure,
            })
            absorptionExecutions.push({ request, outcome: { _tag: 'Failed', error: attempted.failure } as const })
            continue
          }
          if (attempted.success._tag === 'Retry') {
            retryAbsorptions.push(request)
            continue
          }
          absorptionExecutions.push({
            request,
            outcome: { _tag: 'Completed', result: attempted.success.result } as const,
          })
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

        const tntSimulation = yield* Effect.result(runTntSimulation(context, dt))
        if (Result.isFailure(tntSimulation)) {
          yield* recordGameplayStageFailureDeduplicated(state, {
            _tag: 'Failed',
            operation: 'OwnerSnapshot',
            subject: 'Tnt',
            requestId: String(commit?.tntOwnerId ?? 'tnt-service'),
            error: { _tag: 'GameplayStageExecutionFailure', cause: tntSimulation.failure },
          })
        }
        const mobSimulation = yield* Effect.result(runMobSimulation(context, dt))
        if (Result.isFailure(mobSimulation)) {
          yield* recordGameplayStageFailureDeduplicated(state, {
            _tag: 'Failed',
            operation: mobSimulation.failure.operation,
            subject: 'EntityRoster',
            requestId: mobSimulation.failure.requestId,
            error: {
              _tag: 'GameplayStageExecutionFailure',
              cause: mobSimulation.failure.cause,
            },
          })
        }
        yield* spawnQueuedExperienceOrbs(context)

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
      }),
  }
}
