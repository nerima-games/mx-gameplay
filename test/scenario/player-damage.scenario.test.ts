import { describe, expect, it } from '@effect/vitest'
import { DeltaTimeSecs, EntityHealthPoints, EntitySerial } from '@nerima-games/mc-kernel'
import { EntityId, makeTimeService, SPAWN_VITALS } from '@nerima-games/mc-sim'
import { Effect } from 'effect'
import type { MobBehaviour, MobRoster } from '../../src/domain/entities/mob-frame'
import { makeGameplayFrameState, gameplayStages, drainPlayerDamages } from '../../src/stages/registration'
import { ZOMBIE_KIND } from '../../src/domain/mob/hostile-combat'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../../src/domain/entities/xp-orb'
import { PlayerStorageSnapshotSchema } from '@nerima-games/mc-sim'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { makeInventoryDouble } from '../support/inventory-service-double'
import { makeTransactionalChunkStoreDouble, makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import { makePlayerServiceDouble, SPAWN_POSE } from '../support/player-service-double'
import { position } from '../support/coordinate-fixtures'
import { runFrame } from '../support/frame-runner'

describe('player damage gameplay scenario', () => {
  it.effect('a zombie hit is armor-mitigated and commits fatal damage with its cause', () =>
    Effect.gen(function* () {
      const state = yield* makeGameplayFrameState
      const store = yield* makeTransactionalChunkStoreDouble(new Map(), ['0,0'])
      const roster = yield* makeEntityManagerDouble<MobBehaviour>()
      const player = yield* makePlayerServiceDouble(SPAWN_POSE)
      const inventory = yield* makeInventoryDouble()
      const time = yield* makeTimeService()
      const zombie = {
        id: EntityId('zombie:damage-scenario'),
        kind: ZOMBIE_KIND,
        feetPosition: position(0, 64, 0),
        healthPoints: EntityHealthPoints(20),
      }
      const entities = {
        entities: [zombie],
        nextSerial: EntitySerial(1),
      }

      expect(yield* inventory.api.add('iron_helmet', 1)).toBe(0)
      expect((yield* inventory.api.equipFromInventory(0, 'head'))._tag).toBe('Equipped')

      const commit = yield* makeGameplayCommitServices(store.api, inventory.api, {
        playerPose: SPAWN_POSE,
        entities: entities as unknown as MobRoster,
        vitals: { ...SPAWN_VITALS, healthPoints: EntityHealthPoints(2) },
      })
      const stages = gameplayStages(
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
      )

      yield* runFrame(stages, DeltaTimeSecs(0.05))

      const [damage] = yield* drainPlayerDamages(state)
      expect(damage).toMatchObject({
        _tag: 'HostileContact',
        source: zombie.id,
        damage: { cause: 'mob' },
      })
      if (damage === undefined) throw new Error('expected the zombie contact damage event')
      expect(damage.damage.amount).toBeGreaterThan(0)
      expect(damage.damage.amount).toBeLessThan(3)

      const vitalsOwnerId = commit.vitalsOwnerId
      const storageOwnerId = commit.playerStorageOwnerId
      if (vitalsOwnerId === undefined || storageOwnerId === undefined) {
        throw new Error('expected player vitals and storage owners')
      }
      const vitals = yield* commit.coordinator.snapshot(
        vitalsOwnerId,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      const storage = yield* commit.coordinator.snapshot(
        storageOwnerId,
        PlayerStorageSnapshotSchema,
      )

      expect(vitals.state.vitals.healthPoints).toBe(0)
      expect(vitals.state.vitals.lastDamageCause).toBe('mob')
      expect(storage.state.equipment.slots.head?.durability?.current).toBe(164)
    }),
  )
})
