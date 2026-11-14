import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import {
  EntityHealthPoints, EntitySerial, InterpolationFraction, RandomSeed, SimulationTick,
  type EntityHealthPoints as HealthPoints, type PositionAxis,
} from '@nerima-games/mc-kernel'
import {
  EntityId, EntityKind, emptyPlayerStorage, equipmentItem, itemStack, makeReplicatedOwnerId,
  type Entity, type PlayerStorage,
} from '@nerima-games/mc-sim'
import {
  createDroppedItemLifetimeTracker, deathDropsFromPlayerStorage,
  droppedItemOwnerRegistration, droppedItemPickupOwnerRegistrations, spawnDroppedItem,
  type DroppedItemOwnerSnapshot, type DroppedItemSpawn, type PlayerSlotMetadata,
} from '../src/domain/entities/dropped-item'
import {
  CREEPER_KIND, planMobBlastRoster, planMobDamageRoster, planMobExplosionRoster,
  repairMobBehaviour, rollCasualtyDrops, applySpawnAttempts,
  resolveBowHits, resolveBlasts,
  type MobBehaviour, type MobRoster,
} from '../src/domain/entities/mob-frame'
import { DORMANT_FUSE } from '../src/domain/mob/creeper-fuse'
import { searchSpawnCandidates } from '../src/domain/entities/mob-spawn-search'
import { makeChunkStoreDouble, world, STONE } from './support/chunk-store-double'
import { makeEntityManagerDouble } from './support/entity-manager-double'
import { position as fixturePosition } from './support/coordinate-fixtures'
import { SkyLightLevel } from '../src/domain/mob/hostile-spawn'

const at = fixturePosition(0, 64, 0)
const owners = {
  playerStorage: makeReplicatedOwnerId('entity-boundary-player'),
  droppedItems: makeReplicatedOwnerId('entity-boundary-drops'),
}
const entity: Entity<MobBehaviour> = {
  id: EntityId('boundary-mob'), kind: CREEPER_KIND, feetPosition: at,
  healthPoints: EntityHealthPoints(20), behaviour: DORMANT_FUSE,
}
const roster = (healthPoints: number): MobRoster => ({
  entities: [{ ...entity, healthPoints: healthPoints as HealthPoints }], nextSerial: EntitySerial(1),
})

describe('entity input boundaries', () => {
  it('rejects malformed dropped-owner initial state in direct and paired registrations', () => {
    const malformed = { items: [null] } as unknown as DroppedItemOwnerSnapshot
    expect(droppedItemOwnerRegistration(owners.droppedItems, malformed)).toMatchObject({
      _tag: 'Failure', failure: { _tag: 'InvalidDroppedItemOwnerInitialState' },
    })
    expect(droppedItemPickupOwnerRegistrations(owners, emptyPlayerStorage(), malformed)).toMatchObject({
      _tag: 'Failure', failure: { _tag: 'InvalidDroppedItemOwnerInitialState' },
    })
    expect(droppedItemPickupOwnerRegistrations(owners, emptyPlayerStorage())[1].initialState).toStrictEqual({ items: [] })
  })

  it.effect('rejects malformed present drop names and enchantments before mutating the roster', () =>
    Effect.gen(function* () {
      const manager = yield* makeEntityManagerDouble<MobBehaviour>()
      for (const patch of [{ customName: 7 }, { enchantments: [null] }]) {
        const input = { item: 'stone', count: 1, at, ...patch } as unknown as DroppedItemSpawn
        expect(yield* Effect.flip(spawnDroppedItem(manager.api, input))).toMatchObject({ _tag: 'SchemaError' })
      }
      expect(yield* manager.api.count).toBe(0)
    }),
  )

  it('keeps lifetime state unchanged when restore, elapsed time or entity IDs are malformed', () => {
    const tracker = createDroppedItemLifetimeTracker()
    expect(tracker.restore('overworld', [{ entityId: 'kept', elapsedSecs: 4 }])).toStrictEqual(Result.succeed(undefined))
    for (const entries of [null, [null]]) {
      expect(tracker.restore('overworld', entries as unknown as Parameters<typeof tracker.restore>[1])).toStrictEqual(
        Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'elapsedSecs' }),
      )
      expect(tracker.elapsed('overworld', 'kept')).toBe(4)
    }
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(tracker.advance('overworld', delta, ['kept'])).toStrictEqual(
        Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'deltaSecs' }),
      )
    }
    for (const ids of [null, ['kept', 7]]) {
      expect(tracker.advance('overworld', 1, ids as unknown as ReadonlyArray<string>)).toStrictEqual(
        Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'entityIds' }),
      )
    }
    expect(tracker.elapsed('overworld', 'kept')).toBe(4)
    const overflow = Result.getOrThrow(createDroppedItemLifetimeTracker(Number.MAX_VALUE))
    expect(overflow.restore('overworld', [{ entityId: 'large', elapsedSecs: Number.MAX_VALUE }])).toStrictEqual(Result.succeed(undefined))
    expect(overflow.advance('overworld', Number.MAX_VALUE, ['large'])).toStrictEqual(
      Result.fail({ _tag: 'InvalidDroppedItemLifetimeInput', field: 'deltaSecs' }),
    )
    expect(overflow.elapsed('overworld', 'large')).toBe(Number.MAX_VALUE)
  })

  it('rejects malformed death-drop metadata for inventory and equipped items', () => {
    const base = emptyPlayerStorage()
    const stack = Result.getOrThrow(itemStack('iron_helmet', 1))
    const storage: PlayerStorage = {
      ...base, equipment: { slots: { ...base.equipment.slots, head: Result.getOrThrow(equipmentItem(stack)) } },
    }
    for (const metadata of [null, { customNames: {}, enchantedItems: null }]) {
      expect(deathDropsFromPlayerStorage(storage, at, metadata as unknown as PlayerSlotMetadata)).toStrictEqual(
        Result.fail({ _tag: 'InvalidPlayerSlotMetadata', field: 'metadata' }),
      )
    }
    for (const value of [undefined, { item: 'iron_helmet', enchantments: 'broken' }]) {
      expect(deathDropsFromPlayerStorage(storage, at, {
        customNames: {}, enchantedItems: { 'equipment:head': value },
      } as unknown as PlayerSlotMetadata)).toStrictEqual(
        Result.fail({ _tag: 'InvalidPlayerSlotMetadata', field: 'enchantedItem' }),
      )
    }
  })

  it('preserves targets and records malformed blast, explosion and summed damage inputs', () => {
    const validRoster = roster(20)
    const invalidBlast = { source: entity.id, kind: CREEPER_KIND, at, explosion: { source: 'creeper' as const, power: Number.NaN } }
    const blast = planMobBlastRoster(validRoster, [invalidBlast], SimulationTick(0))
    expect(blast.roster).toBe(validRoster)
    expect(blast.faults).toMatchObject([{ entityId: entity.id, failure: { _tag: 'InvalidExplosionInput', field: 'power' } }])
    for (const axis of ['x', 'y', 'z'] as const) {
      const explosion = planMobExplosionRoster(validRoster, [{
        id: entity.id, damage: { amount: 1, cause: 'explosion' },
        knockback: { ...fixturePosition(0, 0, 0), [axis]: Number.NaN as PositionAxis },
      }], SimulationTick(0))
      expect(explosion.roster).toBe(validRoster)
      expect(explosion.faults).toMatchObject([{ entityId: entity.id, failure: { _tag: 'InvalidMobExplosionHitInput', field: `knockback.${axis}` } }])
    }
    const overflow = planMobDamageRoster(validRoster, [
      { id: entity.id, damage: { amount: Number.MAX_VALUE, cause: 'projectile' } },
      { id: entity.id, damage: { amount: Number.MAX_VALUE, cause: 'projectile' } },
    ], SimulationTick(0))
    expect(overflow.roster).toBe(validRoster)
    expect(overflow.faults).toMatchObject([{ entityId: entity.id, failure: { _tag: 'InvalidDamageApplicationInput', field: 'damage.amount' } }])
    const invalidHealth = roster(Number.NaN)
    const damage = planMobDamageRoster(invalidHealth, [{ id: entity.id, damage: { amount: 1, cause: 'projectile' } }], SimulationTick(0))
    expect(damage.roster).toBe(invalidHealth)
    expect(damage.faults).toMatchObject([{ entityId: entity.id, failure: { field: 'vitals.healthPoints' } }])
  })

  it.effect('returns an invalid seed without spawning, searching or fabricating casualty drops', () =>
    Effect.gen(function* () {
      expect(rollCasualtyDrops([], Number.NaN)).toStrictEqual(Result.fail({ _tag: 'InvalidFrameRollInput', field: 'seed' }))
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      expect(yield* Effect.flip(searchSpawnCandidates(
        store.api, at, InterpolationFraction(0.9), Number.NaN as RandomSeed,
      ))).toStrictEqual({ _tag: 'InvalidFrameRollInput', field: 'seed' })
      expect((yield* store.calls).reads).toBe(0)
      const manager = yield* makeEntityManagerDouble<MobBehaviour>()
      expect(yield* Effect.flip(applySpawnAttempts(manager.api, [{
        candidate: { groundBlock: STONE, footBlock: STONE, headBlock: STONE, blockLight: Number.NaN,
          skyLight: SkyLightLevel(0), biome: 'PLAINS', timeOfDay: 0.9, distanceToPlayerBlocksXZ: 30 },
        kind: CREEPER_KIND, feetPosition: at,
      }]))).toMatchObject({ _tag: 'InvalidSpawnCandidate' })
      expect(yield* manager.api.count).toBe(0)
    }),
  )

  it('does not wrap unknown entity kinds as hostile snapshots', () => {
    expect(repairMobBehaviour(EntityKind('unregistered'), {
      _tag: 'HostileMob', ageTicks: 0, persistent: false, named: false, tamed: false,
    })).toBeUndefined()
  })

  it.effect('reports invalid blast input and projectile damage overflow without changing live mobs', () =>
    Effect.gen(function* () {
      const manager = yield* makeEntityManagerDouble<MobBehaviour>(roster(20))
      const store = yield* makeChunkStoreDouble(world([]), ['0,0'])
      const blast = yield* resolveBlasts(manager.api, store.api, [{
        source: entity.id, kind: CREEPER_KIND, at, explosion: { source: 'creeper', power: Number.NaN },
      }])
      expect(blast.casualties).toStrictEqual([])
      expect(blast.faults).toMatchObject([{ entityId: entity.id, failure: { _tag: 'InvalidExplosionInput' } }])
      expect(yield* Effect.flip(resolveBowHits(manager.api, [
        { id: entity.id, damage: Number.MAX_VALUE }, { id: entity.id, damage: Number.MAX_VALUE },
      ]))).toStrictEqual({ _tag: 'InvalidDamageApplicationInput', field: 'damage.amount' })
      expect((yield* manager.api.entities)[0]?.healthPoints).toBe(20)
    }),
  )

  it('preserves zero-health mobs and rejects an unknown explosion damage cause', () => {
    const dead = roster(0)
    const transition = planMobExplosionRoster(dead, [{
      id: entity.id, damage: { amount: 1, cause: 'explosion' }, knockback: fixturePosition(0, 0, 0),
    }], SimulationTick(0))
    expect(transition.casualties).toHaveLength(1)
    const malformed = planMobExplosionRoster(roster(20), [{
      id: entity.id, damage: { amount: 1, cause: 'unknown' }, knockback: fixturePosition(0, 0, 0),
    }] as unknown as Parameters<typeof planMobExplosionRoster>[1], SimulationTick(0))
    expect(malformed.faults).toMatchObject([{ entityId: entity.id, failure: { field: 'damage.cause' } }])
    expect(malformed.roster.entities[0]?.healthPoints).toBe(20)
  })
})
