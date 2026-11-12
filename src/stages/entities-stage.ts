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
  rollAt,
  searchSpawnCandidates,
  settled,
  takeBatch,
  drawRolls,
} from './registration-core.js'
import { Brand, Equal, Option, Result, Schema } from 'effect'
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
  droppedItemPickupResultAfterCommit,
  planDroppedItemPickup,
  type DroppedItemSpawn,
  type DroppedItemOwnerSnapshot,
} from '../domain/entities/dropped-item.js'
import {
  ExperienceOrbOwnerSnapshotSchema,
  ExperienceOrbVitalsOwnerSnapshotSchema,
  applyMendingRepair,
  canCollectExperienceOrbAtTick,
  experienceOrbAbsorptionResultAfterCommit,
  isExperienceOrbExpiredAtTick,
  isExperienceOrbWithinAttractionRange,
  isExperienceOrbWithinPickupRange,
  mergeSameValueExperienceOrbStacks,
  planExperienceOrbAbsorption,
  pullExperienceOrbTowardPlayer,
  splitExperienceOrbReward,
  type ExperienceOrbAbsorptionContext,
  type ExperienceOrbMendingInvalid,
  type ExperienceOrbValue,
  type ExperienceOrbRecord,
} from '../domain/entities/xp-orb.js'
import {
  durabilityWearWithEnchantments,
  enchantmentLevel,
  mendOneItemFromExperience,
  thornsRetaliationChance,
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
  if (equipped === null || requestedWear <= 0) return { storage, seed }
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

    yield* commit.tntService.commitDetonation({ id: outcome.id, planRevision: outcome.planRevision }, changes)

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
  const intervalElapsed = yield* Effect.fromResult(
    hostileSpawnSearchDue(stageTick, lastHostileSpawnTick, difficulty),
  )
  const hostileSearchDue = difficulty !== 'peaceful' && intervalElapsed
  const casualtyDrops = rollCasualtyDrops(blast.casualties, sweep.seed)
  const casualtyExperience = rollCasualtyExperience(blast.casualties, casualtyDrops.seed)
  let searchedAttempts: ReadonlyArray<MobSpawnAttempt> = NO_ATTEMPTS
  let nextRollSeed = casualtyExperience.seed
  const timeOfDay = yield* context.time.timeOfDay
  const dimension = playerSnapshot.state.pose.feetPosition.dimension
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
  const spawned = planSpawnAttemptsOnRoster(blast.roster, attempts, difficulty)
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
      const modifiers = yield* Ref.get(state.playerStatusEffectModifiers)
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
          const wear = damageEquipmentWithUnbreaking(
            storage,
            'offhand',
            prepared.shield.durabilityDamage,
            nextRollSeed,
            'tool',
          )
          nextRollSeed = wear.seed
          storage = wear.storage
          if (!hasShield()) shieldState = null
        }
        if (prepared.appliedAmount === 0) continue
        const fireDamage = event.damage.cause === 'lava' || event.damage.cause === 'in_fire' ||
          event.damage.cause === 'on_fire'
        if (modifiers.fireResistance && fireDamage) continue
        if (modifiers.damageTakenMultiplier === 0) continue

        const storageBeforeHit = storage
        const thornsPieces = event._tag === 'HostileContact' &&
          spawned.success.roster.entities.some(({ id }) => id === event.source)
          ? (['head', 'chest', 'legs', 'feet'] as const).flatMap((slot) => {
              const equipped = storageBeforeHit.equipment.slots[slot]
              if (equipped === null) return []
              const enchantments: EnchantmentSource = equipped.components?.enchantments ?? {}
              const chance = thornsRetaliationChance(enchantments)
              return chance > 0 ? [{ slot, chance }] : []
            })
          : []
        const armor = yield* Effect.fromResult(prepareArmorHit(storage.equipment, {
          ...event.damage,
          amount: prepared.appliedAmount,
        }, modifiers.damageTakenMultiplier))
        const amount = yield* Effect.fromResult(DamageAmount.result(armor.damage.amount))
        const cause = yield* Effect.fromResult(DamageCause.result(armor.damage.cause))
        vitals = applyVitalsDamage(vitals!, { amount, cause })
        const wear = damageArmorWithUnbreaking(storage, armor.wornSlots, armor.durabilityWear, nextRollSeed)
        storage = wear.storage
        nextRollSeed = wear.seed
        applied.push({ ...event, damage: armor.damage })

        if (thornsPieces.length > 0) {
          let retaliationDamage: number | undefined
          const triggeredSlots: Array<'head' | 'chest' | 'legs' | 'feet'> = []
          for (const piece of thornsPieces) {
            const chance = drawRolls(nextRollSeed, 1)
            nextRollSeed = chance.seed
            if (rollAt(chance, 0) >= piece.chance) continue
            const damage = drawRolls(nextRollSeed, 1)
            nextRollSeed = damage.seed
            retaliationDamage = Math.max(retaliationDamage ?? 0, 1 + rollAt(damage, 0) * 4)
            triggeredSlots.push(piece.slot)
          }
          for (const slot of triggeredSlots) {
            const wearResult = damageEquipmentWithUnbreaking(storage, slot, 2, nextRollSeed, 'armor')
            storage = wearResult.storage
            nextRollSeed = wearResult.seed
          }
          if (retaliationDamage !== undefined) {
            thornsDamageHits.push({
              id: event.source,
              damage: { amount: retaliationDamage, cause: 'generic' },
              killCredit: 'player',
              lastHitTick: damageTick,
            })
          }
        }
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

  const thornsRetaliations = planMobDamageRoster(spawned.success.roster, thornsDamageHits, damageTick)
  const thornsDrops = rollCasualtyDrops(thornsRetaliations.casualties, nextRollSeed)
  const thornsExperience = rollCasualtyExperience(thornsRetaliations.casualties, thornsDrops.seed)
  nextRollSeed = thornsExperience.seed
  const allMobDrops = [...casualtyDrops.drops, ...thornsDrops.drops]
  const allMobExperience = [...casualtyExperience.experience, ...thornsExperience.experience]

  let droppedCandidate: DroppedItemOwnerSnapshot | undefined
  if (allMobDrops.length > 0) {
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
    const drops: ReadonlyArray<DroppedItemSpawn> = allMobDrops.map(({ item, count, at }) => ({ item, count, at }))
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

  if (casualtyDrops._tag === 'Unsupported') {
    yield* recordMobRuleIssues(state, 'MobDrop', casualtyDrops.issues)
  }
  if (casualtyExperience._tag === 'Unsupported') {
    yield* recordMobRuleIssues(state, 'MobExperience', casualtyExperience.issues)
  }
  if (thornsDrops._tag === 'Unsupported') yield* recordMobRuleIssues(state, 'MobDrop', thornsDrops.issues)
  if (thornsExperience._tag === 'Unsupported') {
    yield* recordMobRuleIssues(state, 'MobExperience', thornsExperience.issues)
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
  if (allMobDrops.length > 0) {
    yield* Ref.update(state.mobDrops, (pending) => [...pending, ...allMobDrops])
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
})

type PlannedMendingRepair = Readonly<{
  storage: PlayerStorage
  experienceRemaining: number
  selectedSlot: string | undefined
}>

const mendingCandidatesForStorage = (
  storage: PlayerStorage,
): ReadonlyArray<Parameters<typeof mendOneItemFromExperience>[0][number]> => {
  const candidates: Array<Parameters<typeof mendOneItemFromExperience>[0][number]> = []
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
  repairedDurability: NonNullable<Parameters<typeof mendOneItemFromExperience>[0][number]['durability']>,
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
): Result.Result<PlannedMendingRepair, Brand.BrandError | Schema.SchemaError | ExperienceOrbMendingInvalid> => {
  const repair = mendOneItemFromExperience(
    mendingCandidatesForStorage(storage),
    orbExperience,
    roll,
  )
  return Result.flatMap(repair, (selected): Result.Result<
    PlannedMendingRepair,
    Schema.SchemaError | ExperienceOrbMendingInvalid
  > => {
    // The caller only plans a repair after finding a damaged Mending candidate,
    // and orb rewards are positive, so the Mending selector must return one.
    const selectedSlot = selected.selectedSlot!
    const repairedDurability = selected.repairedCandidate!.durability!
    const repairedStorage = storageAfterMendingRepair(
      storage,
      selectedSlot,
      repairedDurability,
    )
    const validated = applyMendingRepair(orbExperience, {
      repairedStorage,
      experienceRemaining: selected.xpRemaining,
      repairedDurability,
      selectedLocation: selectedSlot,
    })
    return Result.map(validated, (result): PlannedMendingRepair => ({
      storage: result.repairedStorage,
      experienceRemaining: result.experienceRemaining,
      selectedSlot: result.selectedLocation,
    }))
  })
}

const experienceOrbRecordsForReward = (
  existing: ReadonlyArray<ExperienceOrbRecord>,
  source: string,
  eventIndex: number,
  values: ReadonlyArray<ExperienceOrbValue>,
  at: Schema.Schema.Type<typeof WorldPositionSchema>,
  tick: Schema.Schema.Type<typeof SimulationTickSchema>,
): Result.Result<ReadonlyArray<ExperienceOrbRecord>, Schema.SchemaError> => {
  const next = [...existing]
  const ids = new Set(existing.map(({ id }) => id))
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
      continue
    }
    const id = EntityId(`mx-gameplay:experience-orb/${source}/${tick}/${eventIndex}/${valueIndex}`)
    if (ids.has(id)) continue
    ids.add(id)
    next.push({ id, value, position: at, spawnedAt: tick })
  }
  const validated = Schema.decodeUnknownResult(ExperienceOrbOwnerSnapshotSchema)({ orbs: next })
  return Result.isFailure(validated)
    ? Result.fail(validated.failure)
    : Result.succeed(validated.success.orbs)
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
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb', error: snapshots.failure,
      })
      return
    }
    const [playerSnapshot, orbSnapshot] = snapshots.success
    if (playerSnapshot.revision !== orbSnapshot.revision) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
        error: new WorldRevisionConflict({ expected: playerSnapshot.revision, actual: orbSnapshot.revision }),
      })
      return
    }
    const tick = Schema.decodeUnknownResult(SimulationTickSchema)(yield* Ref.get(state.tickCount))
    if (Result.isFailure(tick)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: tick.failure,
      })
      return
    }
    let nextOrbs = orbSnapshot.state.orbs
    for (const [eventIndex, event] of experiences.entries()) {
      const values = splitExperienceOrbReward(event.amount)
      if (Result.isFailure(values)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: values.failure,
        })
        return
      }
      const at = Schema.decodeUnknownResult(WorldPositionSchema)({
        dimension: event.dimension ?? playerSnapshot.state.pose.feetPosition.dimension,
        x: event.at.x,
        y: event.at.y,
        z: event.at.z,
      })
      if (Result.isFailure(at)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: at.failure,
        })
        return
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
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: spawned.failure,
        })
        return
      }
      nextOrbs = spawned.success
    }
    if (nextOrbs.length !== orbSnapshot.state.orbs.length ||
      nextOrbs.some((orb, index) => orb !== orbSnapshot.state.orbs[index])) {
      const committed = yield* Effect.result(commit.coordinator.commit({
        expectedRevision: orbSnapshot.revision,
        expectedDimensions: [],
        changes: [{ ownerId: commit.experienceOrbsOwnerId, state: { orbs: nextOrbs } }],
      }))
      if (Result.isFailure(committed)) {
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'WorldCommit', subject: 'ExperienceOrb', error: committed.failure,
        })
        return
      }
    }
    yield* Ref.update(state.mobExperience, (pending) => pending.slice(experiences.length))
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
    yield* recordGameplayStageFailure(state, {
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb', error: orbSnapshotResult.failure,
    })
    return []
  }
  const orbSnapshot = orbSnapshotResult.success
  const tick = Schema.decodeUnknownResult(SimulationTickSchema)(yield* Ref.get(state.tickCount))
  if (Result.isFailure(tick)) {
    yield* recordGameplayStageFailure(state, {
      _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: tick.failure,
    })
    return []
  }
  let changed = false
  const liveOrbs: ExperienceOrbRecord[] = []
  for (const orb of orbSnapshot.state.orbs) {
    const expired = isExperienceOrbExpiredAtTick(orb.spawnedAt, tick.success)
    if (Result.isFailure(expired)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: expired.failure,
      })
      return []
    }
    if (expired.success) changed = true
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
        yield* recordGameplayStageFailure(state, {
          _tag: 'Failed', operation: 'WorldCommit', subject: 'ExperienceOrb', error: committed.failure,
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
    yield* recordGameplayStageFailure(state, {
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb', error: playerSnapshotResult.failure,
    })
    return []
  }
  const playerSnapshot = playerSnapshotResult.success
  if (playerSnapshot.revision !== orbSnapshot.revision) {
    yield* recordGameplayStageFailure(state, {
      _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'ExperienceOrb',
      error: new WorldRevisionConflict({ expected: playerSnapshot.revision, actual: orbSnapshot.revision }),
    })
    return []
  }
  const playerPosition = playerSnapshot.state.pose.feetPosition
  const lastCollectedTick = yield* Ref.get(state.lastExperienceOrbPickupTick)
  const mayCollect = canCollectExperienceOrbAtTick(tick.success, lastCollectedTick ?? undefined)
  if (Result.isFailure(mayCollect)) {
    yield* recordGameplayStageFailure(state, {
      _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: mayCollect.failure,
    })
    return []
  }
  let closest: Readonly<{ orb: ExperienceOrbRecord; distanceSquared: number }> | undefined
  const nextOrbs: ExperienceOrbRecord[] = []
  for (const orb of liveOrbs) {
    if (orb.position === undefined) {
      nextOrbs.push(orb)
      continue
    }
    const inRange = isExperienceOrbWithinAttractionRange(orb.position, playerPosition)
    if (Result.isFailure(inRange)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: inRange.failure,
      })
      return []
    }
    if (!inRange.success) {
      nextOrbs.push(orb)
      continue
    }
    const pulled = pullExperienceOrbTowardPlayer(orb.position, playerPosition, Number(dt))
    if (Result.isFailure(pulled)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: pulled.failure,
      })
      return []
    }
    const moved = pulled.success.x !== orb.position.x || pulled.success.y !== orb.position.y ||
      pulled.success.z !== orb.position.z
    if (moved) changed = true
    const nextPosition = moved ? pulled.success : orb.position
    const nextOrb = moved ? { ...orb, position: nextPosition } : orb
    nextOrbs.push(nextOrb)
    const pickupRange = isExperienceOrbWithinPickupRange(nextPosition, playerPosition)
    if (Result.isFailure(pickupRange)) {
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'CandidateBuild', subject: 'ExperienceOrb', error: pickupRange.failure,
      })
      return []
    }
    if (pickupRange.success) {
      const distanceSquared = (nextPosition.x - playerPosition.x) ** 2 +
        (nextPosition.y - playerPosition.y) ** 2 + (nextPosition.z - playerPosition.z) ** 2
      if (closest === undefined || distanceSquared < closest.distanceSquared) {
        closest = { orb: nextOrb, distanceSquared }
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
      yield* recordGameplayStageFailure(state, {
        _tag: 'Failed', operation: 'WorldCommit', subject: 'ExperienceOrb', error: committed.failure,
      })
      return []
    }
  }
  if (!mayCollect.success || closest === undefined) return []
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
          const storageSnapshot = commit.playerStorageOwnerId === undefined
            ? undefined
            : yield* Effect.result(commit.coordinator.snapshot(
              commit.playerStorageOwnerId,
              PlayerStorageSnapshotSchema,
            ))
          if (storageSnapshot !== undefined && Result.isFailure(storageSnapshot)) {
            absorptionExecutions.push({
              request,
              outcome: { _tag: 'Failed', error: storageSnapshot.failure } as const,
            })
            continue
          }
          const storage = storageSnapshot === undefined || Result.isFailure(storageSnapshot)
            ? undefined
            : storageSnapshot.success
          if (storage !== undefined && storage.revision !== vitalsSnapshot.revision) {
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
          let experienceRemaining: number = planned.success.experience
          let repairedStorage: PlayerStorage | undefined
          let rollSeed: number | undefined
          if (storage !== undefined) {
            const candidates = mendingCandidatesForStorage(storage.state)
            const eligibleMending = candidates.some(({ durability, enchantments }) =>
              durability !== null &&
              durability.max > durability.current &&
              enchantmentLevel(enchantments, 'mending') > 0,
            )
            if (eligibleMending) {
              const currentSeed = yield* Ref.get(state.rollSeed)
              const rolls = drawRolls(currentSeed, 1)
              const roll = yield* Effect.fromResult(InterpolationFraction.result(rollAt(rolls, 0)))
              const repair = yield* Effect.fromResult(
                planMendingRepair(storage.state, planned.success.experience, roll),
              )
              experienceRemaining = repair.experienceRemaining
              repairedStorage = repair.selectedSlot === undefined
                ? undefined
                : repair.storage
              rollSeed = rolls.seed
            }
          }
          const experienceDelta = yield* Effect.fromResult(ExperienceDelta.result(experienceRemaining))
          const vitalsCandidate = yield* Effect.fromResult(
            Schema.decodeUnknownResult(ExperienceOrbVitalsOwnerSnapshotSchema)({
              vitals: addExperience(vitalsSnapshot.state.vitals, experienceDelta),
            }),
          )
          const changes = [
            { ownerId: owners.vitals, state: vitalsCandidate },
            { ownerId: owners.orbs, state: planned.success.orbs },
            ...(repairedStorage === undefined || commit.playerStorageOwnerId === undefined
              ? []
              : [{ ownerId: commit.playerStorageOwnerId, state: repairedStorage }]),
          ]
          const committed = yield* Effect.result(commit.coordinator.commit({
            expectedRevision: vitalsSnapshot.revision,
            expectedDimensions: [],
            changes,
          }))
          if (Result.isFailure(committed)) {
            retryAbsorptions.push(request)
            continue
          }
          if (rollSeed !== undefined) yield* Ref.set(state.rollSeed, rollSeed)
          const result = yield* experienceOrbAbsorptionResultAfterCommit(
            planned.success,
            vitalsCandidate,
            planned.success.orbs,
            owners,
          )
          absorptionExecutions.push({ request, outcome: { _tag: 'Completed', result } as const })
          if (automaticOrbIds.has(request.orb)) {
            const tick = Schema.decodeUnknownResult(SimulationTickSchema)(request.tick)
            if (Result.isSuccess(tick)) yield* Ref.set(state.lastExperienceOrbPickupTick, tick.success)
          }
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
      })),
  }
}
