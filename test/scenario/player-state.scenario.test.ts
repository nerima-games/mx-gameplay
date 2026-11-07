import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import {
  DeltaTimeSecs,
  FoodSaturation,
  StackCount,
  itemStack,
} from '@nerima-games/mc-kernel'
import {
  HungerPoints,
  PlayerStorageSnapshotSchema,
  type PlayerVitals,
} from '@nerima-games/mc-sim'
import { makeInMemoryWorld } from '../../src/domain/in-memory-world'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import { SPAWN_PLAYER_VITALS } from '../../src/domain/in-memory-vitals'
import { ExperienceOrbVitalsOwnerSnapshotSchema } from '../../src/domain/entities/xp-orb'
import { GAMEPLAY_VITALS_OWNER_ID } from '../../src/stages/gameplay-owner-registrations'
import {
  drainItemUseResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestFoodUse,
} from '../../src/stages/registration'
import { makeGameplayCommitServices } from '../support/transactional-stage-doubles'
import { runFrame } from '../support/frame-runner'
import { emptySlots } from '../../src/domain/in-memory-inventory'

describe('player state gameplay scenarios', () => {
  it.effect('eating cod commits one item and raises low hunger through gameplay stages', () =>
    Effect.gen(function* () {
      const lowVitals: PlayerVitals = {
        ...SPAWN_PLAYER_VITALS,
        hungerPoints: HungerPoints(10),
        saturation: FoodSaturation(0),
      }
      const slots = [...emptySlots()]
      slots[0] = Result.getOrThrow(itemStack('cod', StackCount(2)))
      slots[1] = Result.getOrThrow(itemStack('bread', StackCount(3)))
      const world = yield* makeInMemoryWorld<MobBehaviour>({ inventory: slots, vitals: lowVitals })
      const commit = yield* makeGameplayCommitServices(world.chunkStore, world.inventory, {
        vitals: lowVitals,
      })
      const state = yield* makeGameplayFrameStateForOwner({
        coordinator: commit.coordinator,
        vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
      })
      const stages = gameplayStages(
        state,
        world.chunkStore,
        world.entities,
        world.inventory,
        world.player,
        world.time,
        undefined,
        undefined,
        {},
        commit,
      )

      yield* requestFoodUse(state, 'eat-one-cod', 'cod', {
        healthPoints: lowVitals.healthPoints,
        hungerPoints: lowVitals.hungerPoints,
        maxHungerPoints: lowVitals.maxHungerPoints,
      })
      yield* runFrame(stages, DeltaTimeSecs(0))

      expect(yield* drainItemUseResults(state)).toStrictEqual([
        {
          action: 'EatFood',
          requestId: 'eat-one-cod',
          heldItem: 'cod',
          success: true,
          consumedCount: 1,
          outcome: expect.objectContaining({ _tag: 'consume' }),
        },
      ])
      const storageSnapshot = yield* commit.coordinator.snapshot(
        commit.playerStorageOwnerId,
        PlayerStorageSnapshotSchema,
      )
      const storage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(storageSnapshot.state)
      const vitalsSnapshot = yield* commit.coordinator.snapshot(
        commit.vitalsOwnerId,
        ExperienceOrbVitalsOwnerSnapshotSchema,
      )
      const vitals = Schema.decodeUnknownSync(ExperienceOrbVitalsOwnerSnapshotSchema)(vitalsSnapshot.state)
      const count = (item: string) =>
        storage.inventory.slots.reduce(
          (total, slot) => total + (slot?.item === item ? slot.count : 0),
          0,
        )

      expect(count('cod')).toBe(1)
      expect(count('bread')).toBe(3)
      expect(vitals.vitals.hungerPoints).toBe(12)
      expect(vitals.vitals.saturation).toBeGreaterThan(0)
      expect(storageSnapshot.revision).toBe(vitalsSnapshot.revision)
    }),
  )
})
