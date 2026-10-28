import { describe, expect, it } from '@effect/vitest'
import {
  DeltaTimeSecs,
  PositionAxis,
  StackCount,
  blockIdOf,
  position,
  type DeltaTimeSecs as DeltaTimeSecsValue,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import { EntityId, WorldCommitEmptyRequest, itemStack as makeItemStack, makeTimeService } from '@nerima-games/mc-sim'
import { Effect, Option, Ref, Result, Schema } from 'effect'
import {
  drainDroppedItemPickupExecutions,
  drainExperienceOrbAbsorptionExecutions,
  drainItemUseResults,
  getPlayerMovementSpeedMultiplier,
  gameplayStages,
  makeGameplayFrameState,
  requestDroppedItemPickup,
  requestExperienceOrbAbsorption,
  requestPotatoPlanting,
  requestSoilTill,
  requestStatusEffect,
  setPlayerDead,
} from '../src/stages/registration'
import { candidateForPlayerStorageItemUse } from '../src/stages/registration-core'
import { PlayerStorageSnapshotSchema } from '@nerima-games/mc-sim'
import type { MobBehaviour } from '../src/domain/entities/mob-frame'
import { GAMEPLAY_STAGE_IDS } from '../src/stages/stage-ids'
import { StatusEffectStateSchema } from '../src/domain/status-effect'
import { INITIAL_DIMENSION } from '../src/domain/in-memory-player'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../src/domain/entities/xp-orb'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { emptySlots, makeInventoryDouble } from './support/inventory-service-double'
import { makePlayerServiceDouble, SPAWN_POSE } from './support/player-service-double'
import { FrameServicesLayer } from './support/frame-services'
import { makeGameplayCommitServices, makeTransactionalChunkStoreDouble } from './support/transactional-stage-doubles'
import { world } from './support/chunk-store-double'
import { blockPosition as fixtureBlockPosition } from './support/coordinate-fixtures'
import {
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
} from '../src/stages/gameplay-owner-registrations'

const makeHarness = (
  initial: ReturnType<typeof world>,
  withCommit: boolean,
) => Effect.gen(function* () {
  const state = yield* makeGameplayFrameState
  const store = yield* makeTransactionalChunkStoreDouble(initial, ['0,0'])
  const roster = yield* makeEntityManagerDouble<MobBehaviour>()
  const inventory = yield* makeInventoryDouble(emptySlots())
  const player = yield* makePlayerServiceDouble()
  const time = yield* makeTimeService()
  const commit = withCommit
    ? yield* makeGameplayCommitServices(store.api, inventory.api, { playerPose: SPAWN_POSE })
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
})
