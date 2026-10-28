import { describe, expect, it } from '@effect/vitest'
import {
  DeltaTimeSecs,
  EntityHealthPoints,
  EntitySerial,
  PositionAxis,
  StackCount,
  blockIdOf,
  position,
  type DeltaTimeSecs as DeltaTimeSecsValue,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  WorldCommitEmptyRequest,
  itemStack as makeItemStack,
  makeReplicatedOwnerId,
  makeTimeService,
  type ReplicatedOwnerId,
  type WorldCommitCoordinatorApi,
} from '@nerima-games/mc-sim'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import {
  drainDroppedItemPickupExecutions,
  drainExperienceOrbAbsorptionExecutions,
  drainItemUseResults,
  drainPlayerDamages,
  drainPlayerHeals,
  getPlayerMovementSpeedMultiplier,
  gameplayStages,
  makeGameplayFrameState,
  makeGameplayFrameStateForOwner,
  requestDroppedItemPickup,
  requestExperienceOrbAbsorption,
  requestFireExtinguish,
  requestPotatoPlanting,
  requestSoilTill,
  requestStatusEffect,
  setPlayerDead,
} from '../src/stages/registration'
import {
  candidateForItemUse,
  candidateForPlayerStorageItemUse,
} from '../src/stages/registration-core'
import { PlayerStorageSnapshotSchema } from '@nerima-games/mc-sim'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import { StatusEffectStateSchema } from '../src/domain/status-effect'
import { INITIAL_DIMENSION } from '../src/domain/in-memory-player'
import {
  FIRE_DAMAGE_INTERVAL_TICKS,
  FIRE_TICK_INTERVAL_SECS,
  makeFireLifecycleState,
} from '../src/domain/fire-lifecycle'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../src/domain/entities/xp-orb'
import { DroppedItemOwnerSnapshotSchema } from '../src/domain/entities/dropped-item'
import { ZOMBIE_KIND } from '../src/domain/mob/hostile-combat'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makePlayerServiceDouble, SPAWN_POSE } from './support/player-service-double'
import { FrameServicesLayer } from './support/frame-services'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles'
import type { GameplayOwnerInitialState } from '../src/stages/gameplay-owner-registrations'
import { world } from './support/chunk-store-double'
import { blockPosition as fixtureBlockPosition } from './support/coordinate-fixtures'
import {
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
} from '../src/stages/gameplay-owner-registrations'

const makeHarness = (
  initial: ReturnType<typeof world>,
  withCommit: boolean,
  ownerInitial: GameplayOwnerInitialState = {},
) => Effect.gen(function* () {
  const state = yield* makeGameplayFrameState
  const store = yield* makeTransactionalChunkStoreDouble(initial, ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const inventory = yield* makeInventoryDouble(emptySlots())
  const player = yield* makePlayerServiceDouble()
  const time = yield* makeTimeService()
  const commit = withCommit
    ? yield* makeGameplayCommitServices(store.api, inventory.api, { playerPose: SPAWN_POSE, ...ownerInitial })
    : undefined
  const interactions = gameplayStages(
    state,
    store.api,
    roster.api,
    inventory.api,
    player.api,
    time,
    undefined,
    undefined,
    {},
    commit,
  ).find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
  if (interactions === undefined) throw new Error('interactions stage was not registered')
  return { state, store, roster, inventory, player, time, commit, interactions }
})

type Harness = Effect.Success<ReturnType<typeof makeHarness>>
type GameplayStageCommitServices = NonNullable<Parameters<typeof gameplayStages>[9]>

const interactionsWithCommit = (
  harness: Harness,
  commit: GameplayStageCommitServices | undefined,
) => {
  const interactions = gameplayStages(
    harness.state,
    harness.store.api,
    harness.roster.api,
    harness.inventory.api,
    harness.player.api,
    harness.time,
    undefined,
    undefined,
    {},
    commit,
  ).find((stage) => stage.id === GAMEPLAY_STAGE_IDS.interactions)
  if (interactions === undefined) throw new Error('interactions stage was not registered')
  return interactions
}

const fireStageWithCommit = (
  harness: Harness,
  commit: GameplayStageCommitServices | undefined,
) => gameplayStages(
  harness.state,
  harness.store.api,
  harness.roster.api,
  harness.inventory.api,
  harness.player.api,
  harness.time,
  undefined,
  undefined,
  {},
  commit,
).find((stage) => stage.id === GAMEPLAY_STAGE_IDS.fire)

const makeFireCasualtyHarness = () => Effect.gen(function* () {
  const firePosition = fixtureBlockPosition(9, 64, 9)
  const fireBlock = Option.getOrThrow(blockIdOf('fire'))
  const supportBlock = Option.getOrThrow(blockIdOf('stone'))
  const entity = {
    id: EntityId('test:fire-zombie-drop'),
    kind: ZOMBIE_KIND,
    feetPosition: position(
      PositionAxis(firePosition.x),
      PositionAxis(firePosition.y),
      PositionAxis(firePosition.z),
    ),
    healthPoints: EntityHealthPoints(1),
    behaviour: undefined,
  }
  const harness = yield* makeHarness(world([
    [fixtureBlockPosition(firePosition.x, firePosition.y - 1, firePosition.z), supportBlock],
    [firePosition, fireBlock],
  ]), true, {
    entities: { entities: [entity], nextSerial: EntitySerial(1) },
  })
  return { ...harness, entity, firePosition }
})

const coordinatorWithInterveningStatusCommit = (
  coordinator: WorldCommitCoordinatorApi,
  statusEffectsOwnerId: ReplicatedOwnerId,
): Effect.Effect<WorldCommitCoordinatorApi> => Effect.gen(function* () {
  const committed = yield* Ref.make(false)
  const revision = Effect.gen(function* () {
    const beforeConcurrentCommit = yield* coordinator.revision
    if (!(yield* Ref.get(committed))) {
      yield* Ref.set(committed, true)
      yield* Effect.orDie(coordinator.snapshot(statusEffectsOwnerId, StatusEffectStateSchema))
      yield* Effect.orDie(coordinator.commit({
        expectedRevision: beforeConcurrentCommit,
        expectedDimensions: [],
        changes: [{
          ownerId: statusEffectsOwnerId,
          state: {
            effects: [{ type: 'speed', remainingSecs: 1, pulseClockSecs: 0, amplifier: 0 }],
          },
        }],
      }))
    }
    return beforeConcurrentCommit
  })
  return { ...coordinator, revision }
})

const runInteractions = (interactions: StageRegistration, dt: number) =>
  interactions.run(DeltaTimeSecs(dt)).pipe(Effect.provide(FrameServicesLayer))

describe('registration-core public paths omitted from focused coverage', () => {
  it.effect('does not read or mutate vitals when setting an already-living player alive', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const before = yield* state.survivalHunger.snapshot

      yield* setPlayerDead(state, false)

      expect(yield* state.survivalHunger.snapshot).toStrictEqual(before)
    }),
  )

  it.effect('only creates storage candidates when the requested transition changes an item', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const storage = yield* harness.inventory.api.storageSnapshot
      const stone = Result.getOrThrow(makeItemStack('stone', StackCount(1)))
      const withStone = {
        ...storage,
        inventory: {
          ...storage.inventory,
          slots: storage.inventory.slots.map((slot, index) => index === 0 ? stone : slot),
        },
      }

      const consumed = candidateForPlayerStorageItemUse(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        withStone,
        'stone',
        'consume',
      )
      const missing = candidateForPlayerStorageItemUse(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        storage,
        'stone',
        'consume',
      )
      const notDurable = candidateForPlayerStorageItemUse(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        withStone,
        'stone',
        'damage',
      )

      expect(consumed).toBeDefined()
      if (consumed !== undefined) {
        expect(consumed.ownerId).toBe(GAMEPLAY_PLAYER_STORAGE_OWNER_ID)
        const decoded = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(consumed.state)
        expect(decoded.inventory.slots[0]).toBeUndefined()
      }
      expect(missing).toBeUndefined()
      expect(notDurable).toBeUndefined()
    }),
  )

  it.effect('returns a valid storage candidate when damaging a durable inventory item', () =>
    Effect.gen(function* () {
      const store = yield* makeTransactionalChunkStoreDouble(world([]), ['0,0'])
      const slots = [...emptySlots()]
      slots[0] = Result.getOrThrow(makeItemStack('wooden_pickaxe', StackCount(1)))
      const inventory = yield* makeInventoryDouble(slots)
      const commit = yield* makeGameplayCommitServices(store.api, inventory.api)
      const before = yield* commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      const durabilityBefore = before.state.inventoryDurability[0]
      if (durabilityBefore === undefined || durabilityBefore === null) {
        throw new Error('the wooden pickaxe durability was not initialized')
      }

      const result = yield* candidateForItemUse(
        commit.coordinator,
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        'wooden_pickaxe',
        'damage',
      )

      expect(Result.isSuccess(result)).toBe(true)
      const candidate = Result.getOrThrow(result)
      expect(candidate).toBeDefined()
      if (candidate === undefined) throw new Error('durable item damage did not produce a candidate')
      expect(candidate.ownerId).toBe(GAMEPLAY_PLAYER_STORAGE_OWNER_ID)
      const decoded = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(candidate.state)
      expect(decoded.inventory.slots[0]?.item).toBe('wooden_pickaxe')
      expect(decoded.inventoryDurability[0]).toStrictEqual({
        current: durabilityBefore.current - 1,
        max: durabilityBefore.max,
      })
    }),
  )

  it.effect('keeps status-effect requests pending and reports the missing owner when no commit service is registered', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), false)
      const application = { type: 'speed' as const, durationSecs: 1 }

      yield* requestStatusEffect(harness.state, application)
      yield* runInteractions(harness.interactions, 0)

      expect(yield* Ref.get(harness.state.unsupportedOperations)).toContainEqual({
        _tag: 'Unsupported',
        action: 'Brewing',
        reason: 'OwnerRegistrationUnavailable',
      })
      expect(yield* Ref.get(harness.state.pendingStatusEffects)).toStrictEqual([application])

      const registered = yield* makeHarness(world([]), true)
      const commit = registered.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      const { statusEffectsOwnerId: _statusEffectsOwnerId, ...withoutStatusOwner } = commit
      const interactions = interactionsWithCommit(registered, withoutStatusOwner)
      yield* requestStatusEffect(registered.state, application)
      yield* runInteractions(interactions, 0)

      expect(yield* Ref.get(registered.state.unsupportedOperations)).toContainEqual({
        _tag: 'Unsupported',
        action: 'Brewing',
        reason: 'OwnerRegistrationUnavailable',
      })
      expect(yield* Ref.get(registered.state.pendingStatusEffects)).toStrictEqual([application])
    }),
  )

  it.effect('resets an empty status state and commits a speed-only effect without changing vitals', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const commit = harness.commit
      if (commit === undefined || commit.statusEffectsOwnerId === undefined) {
        throw new Error('status-effect owner was not registered')
      }
      const revisionBefore = yield* commit.coordinator.revision

      yield* runInteractions(harness.interactions, 0)
      expect(yield* getPlayerMovementSpeedMultiplier(harness.state)).toBe(1)
      expect((yield* commit.coordinator.snapshot(commit.statusEffectsOwnerId, StatusEffectStateSchema)).state.effects)
        .toStrictEqual([])
      expect(yield* commit.coordinator.revision).toBe(revisionBefore)

      yield* requestStatusEffect(harness.state, { type: 'speed', durationSecs: 1 })
      yield* runInteractions(harness.interactions, 0)
      expect(yield* getPlayerMovementSpeedMultiplier(harness.state)).toBe(1.2)
      expect((yield* commit.coordinator.snapshot(commit.statusEffectsOwnerId, StatusEffectStateSchema)).state.effects)
        .toStrictEqual([{ type: 'speed', remainingSecs: 1, pulseClockSecs: 0, amplifier: 0 }])

      yield* runInteractions(harness.interactions, 1)
      expect((yield* commit.coordinator.snapshot(commit.statusEffectsOwnerId, StatusEffectStateSchema)).state.effects)
        .toStrictEqual([])
      const expiredRevision = yield* commit.coordinator.revision
      yield* runInteractions(harness.interactions, 0)

      expect(yield* getPlayerMovementSpeedMultiplier(harness.state)).toBe(1)
      expect(yield* commit.coordinator.revision).toBe(expiredRevision)
    }),
  )

  it.effect('commits poison, regeneration, hunger, and speed applications with their tick effects', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const commit = harness.commit
      if (commit?.statusEffectsOwnerId === undefined || commit.vitalsOwnerId === undefined) {
        throw new Error('status-effect and vitals owners were not registered')
      }
      const vitalsBefore = yield* commit.coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )

      for (const application of [
        { type: 'poison', durationSecs: 3, amplifier: 1 },
        { type: 'regeneration', durationSecs: 3, amplifier: 1 },
        { type: 'hunger', durationSecs: 3, amplifier: 1 },
        { type: 'speed', durationSecs: 3 },
      ] as const) {
        yield* requestStatusEffect(harness.state, application)
      }
      yield* runInteractions(harness.interactions, 2.5)

      const status = yield* commit.coordinator.snapshot(commit.statusEffectsOwnerId, StatusEffectStateSchema)
      expect(status.state.effects).toStrictEqual([
        { type: 'poison', remainingSecs: 0.5, pulseClockSecs: 0, amplifier: 1 },
        { type: 'regeneration', remainingSecs: 0.5, pulseClockSecs: 0, amplifier: 1 },
        { type: 'speed', remainingSecs: 0.5, pulseClockSecs: 0, amplifier: 0 },
        { type: 'hunger', remainingSecs: 0.5, pulseClockSecs: 0, amplifier: 1 },
      ])
      const vitalsAfter = yield* commit.coordinator.snapshot(
        GAMEPLAY_VITALS_OWNER_ID,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      expect(vitalsAfter.state.vitals.healthPoints).toBe(vitalsBefore.state.vitals.healthPoints - 3)
      expect(vitalsAfter.state.vitals.exhaustion).toBe(vitalsBefore.state.vitals.exhaustion + 0.5)
      expect(yield* drainPlayerHeals(harness.state)).toStrictEqual([
        {
          _tag: 'StatusEffect',
          effect: 'regeneration',
          amount: 1,
          maximumHealthPoints: 20,
        },
        {
          _tag: 'StatusEffect',
          effect: 'regeneration',
          amount: 1,
          maximumHealthPoints: 20,
        },
      ])
      expect(yield* getPlayerMovementSpeedMultiplier(harness.state)).toBe(1.2)
      expect(yield* Ref.get(harness.state.pendingStatusEffects)).toStrictEqual([])
    }),
  )

  it.effect('keeps a status application pending when a valid high amplifier overflows its poison pulse clock', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const commit = harness.commit
      if (commit?.statusEffectsOwnerId === undefined) throw new Error('status-effect owner was not registered')
      const application = { type: 'poison' as const, durationSecs: 2, amplifier: Number.MAX_SAFE_INTEGER }

      yield* requestStatusEffect(harness.state, application)
      yield* runInteractions(harness.interactions, 1)

      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(
        expect.objectContaining({ _tag: 'Failed', operation: 'CandidateBuild', subject: 'Brewing' }),
      )
      expect(yield* Ref.get(harness.state.pendingStatusEffects)).toStrictEqual([application])
      expect((yield* commit.coordinator.snapshot(commit.statusEffectsOwnerId, StatusEffectStateSchema)).state.effects)
        .toStrictEqual([])
      expect(yield* commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('reports finite hunger inputs whose derived exhaustion exceeds the vitals amount schema', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const commit = harness.commit
      if (commit?.statusEffectsOwnerId === undefined) throw new Error('status-effect owner was not registered')
      const application = {
        type: 'hunger' as const,
        durationSecs: Number.MAX_VALUE,
        amplifier: Number.MAX_SAFE_INTEGER,
      }

      yield* requestStatusEffect(harness.state, application)
      yield* runInteractions(harness.interactions, Number.MAX_VALUE)

      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(
        expect.objectContaining({ _tag: 'Failed', operation: 'CandidateBuild', subject: 'Vitals' }),
      )
      expect(yield* Ref.get(harness.state.pendingStatusEffects)).toStrictEqual([application])
      expect((yield* commit.coordinator.snapshot(commit.statusEffectsOwnerId, StatusEffectStateSchema)).state.effects)
        .toStrictEqual([])
      expect(yield* commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('reports a status snapshot schema mismatch through the owner-snapshot failure channel', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const commit = harness.commit
      if (commit === undefined || commit.vitalsOwnerId === undefined) {
        throw new Error('vitals owner was not registered')
      }
      const mismatchedCommit: GameplayStageCommitServices = {
        ...commit,
        statusEffectsOwnerId: commit.vitalsOwnerId,
      }
      const interactions = interactionsWithCommit(harness, mismatchedCommit)

      yield* requestStatusEffect(harness.state, { type: 'speed', durationSecs: 1 })
      yield* runInteractions(interactions, 0)

      expect(yield* Ref.get(harness.state.operationFailures)).toMatchObject([
        { _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Brewing' },
      ])
      expect(yield* Ref.get(harness.state.pendingStatusEffects)).toHaveLength(1)
    }),
  )

  it.effect('records a player owner snapshot schema mismatch and stops the interactions stage', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const commit = harness.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      const mismatchedCommit: GameplayStageCommitServices = {
        ...commit,
        playerOwnerId: commit.playerStorageOwnerId,
      }
      const interactions = interactionsWithCommit(harness, mismatchedCommit)

      yield* runInteractions(interactions, 0)

      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(
        expect.objectContaining({
          _tag: 'Failed',
          operation: 'OwnerSnapshot',
          subject: 'Player',
        }),
      )
      expect(yield* commit.coordinator.revision).toBe(0)
    }),
  )

  it.effect('reports a missing vitals owner when a poison tick needs to change health', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const commit = harness.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      const { vitalsOwnerId: _vitalsOwnerId, ...withoutVitalsOwner } = commit
      const interactions = interactionsWithCommit(harness, withoutVitalsOwner)

      yield* requestStatusEffect(harness.state, { type: 'poison', durationSecs: 1 })
      yield* runInteractions(interactions, 1)

      expect(yield* Ref.get(harness.state.unsupportedOperations)).toContainEqual({
        _tag: 'Unsupported',
        action: 'PlayerDamage',
        reason: 'OwnerRegistrationUnavailable',
      })
      expect(yield* Ref.get(harness.state.pendingStatusEffects)).toHaveLength(1)
      const vitals = yield* commit.coordinator.snapshot(GAMEPLAY_VITALS_OWNER_ID, ExperienceOrbVitalsOwnerSnapshotSchema)
      expect(vitals.state.vitals.healthPoints).toBe(20)
    }),
  )

  it.effect('reports a vitals snapshot schema mismatch before applying a poison pulse', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const commit = harness.commit
      if (commit === undefined || commit.statusEffectsOwnerId === undefined) {
        throw new Error('status-effect owner was not registered')
      }
      const mismatchedCommit: GameplayStageCommitServices = {
        ...commit,
        vitalsOwnerId: commit.statusEffectsOwnerId,
      }
      const interactions = interactionsWithCommit(harness, mismatchedCommit)

      yield* requestStatusEffect(harness.state, { type: 'poison', durationSecs: 1 })
      yield* runInteractions(interactions, 1)

      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(
        expect.objectContaining({
          _tag: 'Failed',
          operation: 'OwnerSnapshot',
          subject: 'Vitals',
        }),
      )
      expect(yield* Ref.get(harness.state.pendingStatusEffects)).toHaveLength(1)
    }),
  )

  it.effect('leaves pickup and orb executions empty until the entities stage produces them', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const pickup = {
        actor: EntityId('test:player'),
        tick: 1,
        position: position(PositionAxis(0), PositionAxis(64), PositionAxis(0)),
      }
      const absorption = {
        actor: EntityId('test:player'),
        orb: EntityId('test:experience-orb'),
        tick: 1,
        position: { dimension: INITIAL_DIMENSION, x: 0, y: 64, z: 0 },
      }

      yield* requestDroppedItemPickup(state, pickup)
      yield* requestExperienceOrbAbsorption(state, absorption)

      expect(yield* drainDroppedItemPickupExecutions(state)).toStrictEqual([])
      expect(yield* drainExperienceOrbAbsorptionExecutions(state)).toStrictEqual([])
      expect(yield* Ref.get(state.pendingDroppedItemPickups)).toStrictEqual([pickup])
      expect(yield* Ref.get(state.pendingExperienceOrbAbsorptions)).toStrictEqual([absorption])
      expect(yield* drainDroppedItemPickupExecutions(state)).toStrictEqual([])
      expect(yield* drainExperienceOrbAbsorptionExecutions(state)).toStrictEqual([])
    }),
  )

  it.effect('does not plant without a potato or till without a hoe in registered storage', () =>
    Effect.gen(function* () {
      const plantingPosition = fixtureBlockPosition(2, 64, 2)
      const tillingPosition = fixtureBlockPosition(3, 64, 2)
      const farmland = Option.getOrThrow(blockIdOf('farmland'))
      const dirt = Option.getOrThrow(blockIdOf('dirt'))
      const harness = yield* makeHarness(world([
        [plantingPosition, farmland],
        [tillingPosition, dirt],
      ]), true)

      yield* requestPotatoPlanting(harness.state, 'missing-potato', plantingPosition)
      yield* requestSoilTill(harness.state, 'missing-hoe', tillingPosition, 'iron_hoe')
      yield* runInteractions(harness.interactions, 0)

      expect(yield* drainItemUseResults(harness.state)).toMatchObject([
        {
          action: 'PlantPotato',
          requestId: 'missing-potato',
          success: false,
          consumedCount: 0,
          outcome: { _tag: 'notASeed', held: 'potato' },
        },
        {
          action: 'TillSoil',
          requestId: 'missing-hoe',
          success: false,
          durabilityDamage: 0,
        },
      ])
      if (harness.commit === undefined) throw new Error('commit services were not registered')
      expect(yield* harness.commit.coordinator.revision).toBe(0)
      expect(yield* harness.store.blockAt(plantingPosition)).toBe(farmland)
      expect(yield* harness.store.blockAt(tillingPosition)).toBe(dirt)
    }),
  )

  it.effect('keeps pending status effects when the owner commit rejects the candidate', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), true)
      const commit = harness.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      const rejectingCommit: GameplayStageCommitServices = {
        ...commit,
        coordinator: {
          ...commit.coordinator,
          commit: () => Effect.fail(new WorldCommitEmptyRequest()),
        },
      }
      const interactions = interactionsWithCommit(harness, rejectingCommit)

      yield* requestStatusEffect(harness.state, { type: 'speed', durationSecs: 1 })
      yield* runInteractions(interactions, 0)

      expect(yield* Ref.get(harness.state.operationFailures)).toMatchObject([
        { _tag: 'Failed', operation: 'WorldCommit', subject: 'Brewing', error: expect.any(WorldCommitEmptyRequest) },
      ])
      expect(yield* Ref.get(harness.state.pendingStatusEffects)).toHaveLength(1)
      expect(yield* getPlayerMovementSpeedMultiplier(harness.state)).toBe(1)
      expect((yield* commit.coordinator.snapshot(commit.statusEffectsOwnerId!, StatusEffectStateSchema)).state.effects)
        .toStrictEqual([])
    }),
  )

  it.effect('leaves the fire and fluids stages idle when no commit coordinator is registered', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), false)
      const stages = gameplayStages(
        harness.state,
        harness.store.api,
        harness.roster.api,
        harness.inventory.api,
        harness.player.api,
        harness.time,
        undefined,
        undefined,
        {},
        undefined,
      )
      const fire = stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.fire)
      const fluids = stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.fluids)
      if (fire === undefined || fluids === undefined) throw new Error('world stages were not registered')

      yield* fire.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      yield* fluids.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.state.operationFailures)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.unsupportedOperations)).toStrictEqual([])

      const registered = yield* makeHarness(world([]), true)
      const commit = registered.commit
      if (commit?.playerStorageOwnerId === undefined) throw new Error('player storage owner was not registered')
      const mismatched: GameplayStageCommitServices = {
        ...commit,
        playerOwnerId: commit.playerStorageOwnerId,
      }
      const registeredStages = gameplayStages(
        registered.state,
        registered.store.api,
        registered.roster.api,
        registered.inventory.api,
        registered.player.api,
        registered.time,
        undefined,
        undefined,
        {},
        mismatched,
      )
      const registeredFire = registeredStages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.fire)
      const registeredFluids = registeredStages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.fluids)
      if (registeredFire === undefined || registeredFluids === undefined) {
        throw new Error('registered world stages were not registered')
      }

      yield* registeredFire.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))
      yield* registeredFluids.run(DeltaTimeSecs(0)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(registered.state.operationFailures)).toContainEqual(
        expect.objectContaining({ _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Player' }),
      )
    }),
  )

  it.effect('records a rejected survival-hunger tick as a vitals stage failure', () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(world([]), false)
      const stages = gameplayStages(
        harness.state,
        harness.store.api,
        harness.roster.api,
        harness.inventory.api,
        harness.player.api,
        harness.time,
        undefined,
        undefined,
        {},
        undefined,
      )
      const hunger = stages.find(({ id }) => id === GAMEPLAY_STAGE_IDS.survivalHunger)
      if (hunger === undefined) throw new Error('survival-hunger stage was not registered')

      yield* hunger.run(Number.NaN as DeltaTimeSecsValue).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.state.operationFailures)).toMatchObject([
        { _tag: 'Failed', operation: 'VitalsOperation', subject: 'Vitals' },
      ])
    }),
  )

  it.effect('applies a fire tick to a player standing in the tracked fire cell', () =>
    Effect.gen(function* () {
      const firePosition = fixtureBlockPosition(0, 64, 0)
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const supportBlock = Option.getOrThrow(blockIdOf('stone'))
      const harness = yield* makeHarness(world([
        [fixtureBlockPosition(0, 63, 0), supportBlock],
        [firePosition, fireBlock],
      ]), true)
      if (harness.commit === undefined) throw new Error('commit services were not registered')
      const fire = gameplayStages(
        harness.state,
        harness.store.api,
        harness.roster.api,
        harness.inventory.api,
        harness.player.api,
        harness.time,
        undefined,
        undefined,
        {},
        harness.commit,
      ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.fire)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([firePosition], 17))

      yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* drainPlayerDamages(harness.state)).toStrictEqual([
        {
          _tag: 'FireContact',
          at: { x: 0, y: 64, z: 0 },
          damage: { amount: 1, cause: 'in_fire' },
        },
      ])
      expect((yield* Ref.get(harness.state.fireLifecycle)).burningActors).toContainEqual(
        expect.objectContaining({ id: 'player', kind: 'player' }),
      )
      expect(yield* Ref.get(harness.state.operationFailures)).toStrictEqual([])
    }),
  )

  it.effect('reports fire entity damage as unsupported when the entities owner is not registered', () =>
    Effect.gen(function* () {
      const firePosition = fixtureBlockPosition(0, 64, 0)
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const supportBlock = Option.getOrThrow(blockIdOf('stone'))
      const harness = yield* makeHarness(world([
        [fixtureBlockPosition(0, 63, 0), supportBlock],
        [firePosition, fireBlock],
      ]), true)
      const commit = harness.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      const { entitiesOwnerId: _entitiesOwnerId, ...withoutEntitiesOwner } = commit
      const fire = gameplayStages(
        harness.state,
        harness.store.api,
        harness.roster.api,
        harness.inventory.api,
        harness.player.api,
        harness.time,
        undefined,
        undefined,
        {},
        withoutEntitiesOwner,
      ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.fire)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([firePosition], 19))

      yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.state.unsupportedOperations)).toContainEqual({
        _tag: 'Unsupported',
        action: 'FireEntityDamage',
        reason: 'OwnerRegistrationUnavailable',
      })
      expect(yield* Ref.get(harness.state.operationFailures)).toStrictEqual([])
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toContainEqual(
        expect.objectContaining({ position: firePosition, ageTicks: 0 }),
      )
      expect(yield* drainPlayerDamages(harness.state)).toStrictEqual([])
    }),
  )

  it.effect('reports fire entity damage as unsupported for a valid but unregistered entities owner id', () =>
    Effect.gen(function* () {
      const firePosition = fixtureBlockPosition(0, 64, 0)
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const supportBlock = Option.getOrThrow(blockIdOf('stone'))
      const harness = yield* makeHarness(world([
        [fixtureBlockPosition(0, 63, 0), supportBlock],
        [firePosition, fireBlock],
      ]), true)
      const commit = harness.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      const withUnknownEntitiesOwner: GameplayStageCommitServices = {
        ...commit,
        entitiesOwnerId: makeReplicatedOwnerId('test:unregistered-fire-entities'),
      }
      const fire = gameplayStages(
        harness.state,
        harness.store.api,
        harness.roster.api,
        harness.inventory.api,
        harness.player.api,
        harness.time,
        undefined,
        undefined,
        {},
        withUnknownEntitiesOwner,
      ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.fire)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([firePosition], 29))

      yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.state.unsupportedOperations)).toContainEqual({
        _tag: 'Unsupported',
        action: 'FireEntityDamage',
        reason: 'OwnerRegistrationUnavailable',
      })
      expect(yield* Ref.get(harness.state.operationFailures)).toStrictEqual([])
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toContainEqual(
        expect.objectContaining({ position: firePosition, ageTicks: 0 }),
      )
      expect(yield* drainPlayerDamages(harness.state)).toStrictEqual([])
    }),
  )

  it.effect('reports a fire owner snapshot failure when a registered owner has the wrong state schema', () =>
    Effect.gen(function* () {
      const firePosition = fixtureBlockPosition(0, 64, 0)
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const supportBlock = Option.getOrThrow(blockIdOf('stone'))
      const harness = yield* makeHarness(world([
        [fixtureBlockPosition(0, 63, 0), supportBlock],
        [firePosition, fireBlock],
      ]), true)
      const commit = harness.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      const withMismatchedEntitiesOwner: GameplayStageCommitServices = {
        ...commit,
        entitiesOwnerId: commit.playerOwnerId,
      }
      const fire = gameplayStages(
        harness.state,
        harness.store.api,
        harness.roster.api,
        harness.inventory.api,
        harness.player.api,
        harness.time,
        undefined,
        undefined,
        {},
        withMismatchedEntitiesOwner,
      ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.fire)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([firePosition], 31))

      yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(
        expect.objectContaining({ _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fire' }),
      )
      expect(yield* Ref.get(harness.state.unsupportedOperations)).toStrictEqual([])
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toContainEqual(
        expect.objectContaining({ position: firePosition, ageTicks: 0 }),
      )
      expect(yield* drainPlayerDamages(harness.state)).toStrictEqual([])
    }),
  )

  it.effect('records a vitals owner snapshot failure before advancing active fire', () =>
    Effect.gen(function* () {
      const firePosition = fixtureBlockPosition(0, 64, 0)
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const supportBlock = Option.getOrThrow(blockIdOf('stone'))
      const store = yield* makeTransactionalChunkStoreDouble(world([
        [fixtureBlockPosition(0, 63, 0), supportBlock],
        [firePosition, fireBlock],
      ]), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const inventory = yield* makeInventoryDouble(emptySlots())
      const player = yield* makePlayerServiceDouble()
      const time = yield* makeTimeService()
      const commit = yield* makeGameplayCommitServices(store.api, inventory.api, { playerPose: SPAWN_POSE })
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator: commit.coordinator,
        vitalsOwnerId: makeReplicatedOwnerId('test:unregistered-fire-vitals'),
      })
      const fire = gameplayStages(
        state,
        store.api,
        roster.api,
        inventory.api,
        player.api,
        time,
        undefined,
        undefined,
        {},
        commit,
      ).find(({ id }) => id === GAMEPLAY_STAGE_IDS.fire)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(state.fireLifecycle, makeFireLifecycleState([firePosition], 37))

      yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(state.operationFailures)).toContainEqual(
        expect.objectContaining({ _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Vitals' }),
      )
      expect((yield* Ref.get(state.fireLifecycle)).fires).toContainEqual(
        expect.objectContaining({ position: firePosition, ageTicks: 0 }),
      )
    }),
  )

  it.effect('keeps a fire casualty uncommitted when its dropped-items owner is absent', () =>
    Effect.gen(function* () {
      const harness = yield* makeFireCasualtyHarness()
      const commit = harness.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      const { droppedItemsOwnerId: _droppedItemsOwnerId, ...withoutDropsOwner } = commit
      const fire = fireStageWithCommit(harness, withoutDropsOwner)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(harness.state.rollSeed, 4)
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([harness.firePosition], 41))

      for (let tick = 0; tick <= FIRE_DAMAGE_INTERVAL_TICKS; tick += 1) {
        yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
        if ((yield* Ref.get(harness.state.unsupportedOperations)).length > 0) break
      }

      expect(yield* Ref.get(harness.state.unsupportedOperations)).toContainEqual({
        _tag: 'Unsupported',
        action: 'FireEntityDamage',
        reason: 'OwnerRegistrationUnavailable',
      })
      expect(yield* Ref.get(harness.state.operationFailures)).toStrictEqual([])
      expect(yield* commit.coordinator.revision).toBe(0)
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toContainEqual(
        expect.objectContaining({ position: harness.firePosition, ageTicks: 0 }),
      )
    }),
  )

  it.effect('commits a fire casualty and its dropped items when the registered owners are valid', () =>
    Effect.gen(function* () {
      const harness = yield* makeFireCasualtyHarness()
      const commit = harness.commit
      if (commit?.droppedItemsOwnerId === undefined || commit.entitiesOwnerId === undefined) {
        throw new Error('fire casualty owners were not registered')
      }
      const fire = fireStageWithCommit(harness, commit)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(harness.state.rollSeed, 4)
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([harness.firePosition], 41))

      for (let tick = 0; tick <= FIRE_DAMAGE_INTERVAL_TICKS; tick += 1) {
        yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
        const drops = yield* commit.coordinator.snapshot(
          commit.droppedItemsOwnerId,
          DroppedItemOwnerSnapshotSchema,
        )
        if (drops.state.items.length > 0) break
      }

      const drops = yield* commit.coordinator.snapshot(
        commit.droppedItemsOwnerId,
        DroppedItemOwnerSnapshotSchema,
      )
      expect(drops.state.items.length).toBeGreaterThan(0)
      expect(yield* Ref.get(harness.state.unsupportedOperations)).toStrictEqual([])
      expect(yield* Ref.get(harness.state.operationFailures)).toStrictEqual([])
      expect(yield* commit.coordinator.revision).toBe(1)
    }),
  )

  it.effect('records a fire snapshot failure when the dropped-items owner has another registered schema', () =>
    Effect.gen(function* () {
      const harness = yield* makeFireCasualtyHarness()
      const commit = harness.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      const withMismatchedDropsOwner: GameplayStageCommitServices = {
        ...commit,
        droppedItemsOwnerId: commit.playerOwnerId,
      }
      const fire = fireStageWithCommit(harness, withMismatchedDropsOwner)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(harness.state.rollSeed, 4)
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([harness.firePosition], 43))

      for (let tick = 0; tick <= FIRE_DAMAGE_INTERVAL_TICKS; tick += 1) {
        yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
        if ((yield* Ref.get(harness.state.operationFailures)).length > 0) break
      }

      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(
        expect.objectContaining({ _tag: 'Failed', operation: 'OwnerSnapshot', subject: 'Fire' }),
      )
      expect(yield* Ref.get(harness.state.unsupportedOperations)).toStrictEqual([])
      expect(yield* commit.coordinator.revision).toBe(0)
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toContainEqual(
        expect.objectContaining({ position: harness.firePosition, ageTicks: 0 }),
      )
    }),
  )

  it.effect('rejects a fire tick when the entity snapshot observes a concurrent owner commit', () =>
    Effect.gen(function* () {
      const firePosition = fixtureBlockPosition(0, 64, 0)
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const supportBlock = Option.getOrThrow(blockIdOf('stone'))
      const harness = yield* makeHarness(world([
        [fixtureBlockPosition(0, 63, 0), supportBlock],
        [firePosition, fireBlock],
      ]), true)
      const commit = harness.commit
      if (commit?.entitiesOwnerId === undefined || commit.statusEffectsOwnerId === undefined) {
        throw new Error('fire owners were not registered')
      }
      const coordinator = yield* coordinatorWithInterveningStatusCommit(commit.coordinator, commit.statusEffectsOwnerId)
      const racingCommit: GameplayStageCommitServices = { ...commit, coordinator }
      const fire = fireStageWithCommit(harness, racingCommit)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([firePosition], 47))

      yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))

      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(
        expect.objectContaining({ _tag: 'Failed', operation: 'CandidateBuild', subject: 'Fire' }),
      )
      expect(yield* racingCommit.coordinator.revision).toBe(1)
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toContainEqual(
        expect.objectContaining({ position: firePosition, ageTicks: 0 }),
      )
      expect(yield* drainPlayerDamages(harness.state)).toStrictEqual([])
    }),
  )

  it.effect('rejects dropped-item spawns when their snapshot observes a concurrent owner commit', () =>
    Effect.gen(function* () {
      const harness = yield* makeFireCasualtyHarness()
      const commit = harness.commit
      if (commit?.droppedItemsOwnerId === undefined || commit.statusEffectsOwnerId === undefined) {
        throw new Error('dropped-item and status-effect owners were not registered')
      }
      const coordinator = yield* coordinatorWithInterveningStatusCommit(commit.coordinator, commit.statusEffectsOwnerId)
      const racingCommit: GameplayStageCommitServices = { ...commit, coordinator }
      const fire = fireStageWithCommit(harness, racingCommit)
      if (fire === undefined) throw new Error('fire stage was not registered')
      yield* Ref.set(harness.state.rollSeed, 4)
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([harness.firePosition], 53))

      for (let tick = 0; tick <= FIRE_DAMAGE_INTERVAL_TICKS; tick += 1) {
        yield* fire.run(DeltaTimeSecs(FIRE_TICK_INTERVAL_SECS)).pipe(Effect.provide(FrameServicesLayer))
        if ((yield* Ref.get(harness.state.operationFailures)).length > 0) break
      }

      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(
        expect.objectContaining({ _tag: 'Failed', operation: 'CandidateBuild', subject: 'Fire' }),
      )
      expect(yield* racingCommit.coordinator.revision).toBe(1)
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toContainEqual(
        expect.objectContaining({ position: harness.firePosition, ageTicks: 0 }),
      )
    }),
  )

  it.effect('keeps tracked fire until its world extinguish commit succeeds', () =>
    Effect.gen(function* () {
      const firePosition = fixtureBlockPosition(3, 64, 3)
      const fireBlock = Option.getOrThrow(blockIdOf('fire'))
      const harness = yield* makeHarness(world([[firePosition, fireBlock]]), true)
      const commit = harness.commit
      if (commit === undefined) throw new Error('commit services were not registered')
      yield* Ref.set(harness.state.fireLifecycle, makeFireLifecycleState([firePosition], 23))
      const rejectingCoordinator = {
        ...commit.coordinator,
        commit: () => Effect.fail(new WorldCommitEmptyRequest()),
      }

      expect(yield* requestFireExtinguish(harness.state, firePosition, {
        coordinator: rejectingCoordinator,
        dimension: 'overworld',
        changes: [],
      })).toBe(false)
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toContainEqual(
        expect.objectContaining({ position: firePosition }),
      )
      expect(yield* harness.store.blockAt(firePosition)).toBe(fireBlock)
      expect(yield* Ref.get(harness.state.operationFailures)).toContainEqual(
        expect.objectContaining({
          _tag: 'Failed',
          operation: 'WorldCommit',
          subject: 'Fire',
          error: expect.any(WorldCommitEmptyRequest),
        }),
      )

      expect(yield* requestFireExtinguish(harness.state, firePosition, {
        coordinator: commit.coordinator,
        dimension: 'overworld',
        changes: [],
      })).toBe(true)
      expect(yield* harness.store.blockAt(firePosition)).toBeUndefined()
      expect((yield* Ref.get(harness.state.fireLifecycle)).fires).toStrictEqual([])
    }),
  )
})
