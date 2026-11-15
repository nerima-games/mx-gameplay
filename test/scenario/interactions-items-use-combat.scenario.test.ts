import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Ref, Result } from 'effect'
import {
  AttackRangeDistance,
  blockIdOf,
  EntityHealthPoints,
} from '@nerima-games/mc-kernel'
import {
  EntityId,
  EntitySerial,
  PlayerStorageSnapshotSchema,
  SPAWN_VITALS,
  HungerPoints,
  itemStack,
  makeTimeService,
} from '@nerima-games/mc-sim'
import type { MobBehaviour } from '../../src/domain/entities/mob-frame'
import { CREEPER_KIND } from '../../src/domain/entities/mob-frame'
import { COW_KIND } from '../../src/domain/mob/mob-ecosystem'
import { ZOMBIE_KIND } from '../../src/domain/mob/hostile-combat'
import { DroppedItemOwnerSnapshotSchema } from '../../src/domain/entities/dropped-item'
import {
  drainBlockUseResults,
  drainItemUseResults,
  drainMeleeAttackResults,
  gameplayStages,
  makeGameplayFrameStateForOwner,
  requestFoodUse,
  requestBlockUse,
  requestMeleeAttack,
} from '../../src/stages/registration'
import {
  GAMEPLAY_ENTITIES_OWNER_ID,
  GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
  GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
  GAMEPLAY_VITALS_OWNER_ID,
  GameplayEntityRosterSchema,
  type GameplayOwnerInitialState,
} from '../../src/stages/gameplay-owner-registrations'
import { world } from '../support/chunk-store-double'
import { makeEntityManagerDouble } from '../support/entity-manager-double'
import { emptySlots as inventorySlots, makeInventoryDouble } from '../support/inventory-service-double'
import { makePlayerServiceDouble } from '../support/player-service-double'
import {
  makeGameplayCommitServices,
  makeTransactionalChunkStoreDouble,
} from '../support/transactional-stage-doubles'
import { runFrame } from '../support/frame-runner'
import { blockPosition, position } from '../support/coordinate-fixtures'

const lowVitals = { ...SPAWN_VITALS, hungerPoints: HungerPoints(10) }

type GameplayEntitiesInput = NonNullable<GameplayOwnerInitialState['entities']>
type GameplayEntityInput = GameplayEntitiesInput['entities'][number]
type PersistedGameplayEntitiesInput = Omit<GameplayEntitiesInput, 'entities'> & {
  readonly entities: ReadonlyArray<Omit<GameplayEntityInput, 'behaviour'> | GameplayEntityInput>
}
type PersistedGameplayOwnerInitialState = Omit<GameplayOwnerInitialState, 'entities'> & {
  readonly entities?: PersistedGameplayEntitiesInput
}

const makeSlice = (
  initialSlots = inventorySlots(),
  ownerInitial: PersistedGameplayOwnerInitialState = {},
  initialWorld = world([]),
) =>
  Effect.gen(function* () {
    const store = yield* makeTransactionalChunkStoreDouble(initialWorld, ['0,0'])
    const runtimeEntities: GameplayEntitiesInput = ownerInitial.entities === undefined
      ? { entities: [], nextSerial: EntitySerial(0) }
      : {
          ...ownerInitial.entities,
          entities: ownerInitial.entities.entities.map((entity) => ({
            ...entity,
            behaviour: 'behaviour' in entity ? entity.behaviour : undefined,
          })),
        }
    const { entities: persistedEntities, ...ownerFields } = ownerInitial
    const commitInitial: GameplayOwnerInitialState = {
      ...ownerFields,
      ...(persistedEntities === undefined ? {} : {
        entities: persistedEntities as unknown as GameplayEntitiesInput,
      }),
    }
    const roster = yield* makeEntityManagerDouble<MobBehaviour>(runtimeEntities)
    const inventory = yield* makeInventoryDouble(initialSlots)
    const player = yield* makePlayerServiceDouble()
    const time = yield* makeTimeService()
    const commit = yield* makeGameplayCommitServices(store.api, inventory.api, commitInitial)
    const state = yield* makeGameplayFrameStateForOwner({
      coordinator: commit.coordinator,
      vitalsOwnerId: GAMEPLAY_VITALS_OWNER_ID,
    })
    return {
      state,
      stages: gameplayStages(state, store.api, roster.api, inventory.api, player.api, time, undefined, undefined, {}, commit),
      commit,
    }
  })

describe('item use and combat through gameplay stages', () => {
  it.effect('consumes one available food item and returns the matching use result', () =>
    Effect.gen(function* () {
      const slots = [...inventorySlots()]
      slots[0] = Result.getOrThrow(itemStack('potato', 1))
      const slice = yield* makeSlice(slots, { vitals: lowVitals })

      yield* requestFoodUse(slice.state, 'eat-potato', 'potato', lowVitals)
      yield* runFrame(slice.stages)

      expect(yield* drainItemUseResults(slice.state)).toMatchObject([{
        action: 'EatFood',
        requestId: 'eat-potato',
        heldItem: 'potato',
        success: true,
        consumedCount: 1,
        outcome: { _tag: 'consume', count: 1, foodPoints: 1 },
      }])
      const storage = yield* slice.commit.coordinator.snapshot(
        GAMEPLAY_PLAYER_STORAGE_OWNER_ID,
        PlayerStorageSnapshotSchema,
      )
      expect(storage.state.inventory.slots[0]).toBeUndefined()
    }),
  )

  it.effect('applies a melee hit to the registered target and drains its result once', () =>
    Effect.gen(function* () {
      const target = {
        id: EntityId('melee-scenario-target'),
        kind: CREEPER_KIND,
        feetPosition: position(0, 64.72, -2),
        healthPoints: EntityHealthPoints(20),
      }
      const entities = { entities: [target], nextSerial: EntitySerial(1) }
      const slots = [...inventorySlots()]
      slots[0] = Result.getOrThrow(itemStack('wooden_sword', 1))
      const slice = yield* makeSlice(slots, {
        entities,
        playerPose: { feetPosition: position(0, 64, 0), yawRadians: 0, pitchRadians: 0 },
      })

      yield* requestMeleeAttack(slice.state, {
        requestId: 'melee-front-target',
        origin: position(0, 64, 0),
        direction: position(0, 0, 1),
        reach: AttackRangeDistance(3),
        damage: 4,
        toolLocation: { _tag: 'Inventory', slotIndex: 0 },
      })
      yield* runFrame(slice.stages)

      expect(yield* drainMeleeAttackResults(slice.state)).toMatchObject([{
        requestId: 'melee-front-target',
        success: true,
        target: { id: target.id, distance: 2 },
      }])
      expect(yield* drainMeleeAttackResults(slice.state)).toStrictEqual([])
      const updated = yield* slice.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )
      expect(updated.state.entities[0]?.healthPoints).toBe(16)
    }),
  )

  it.effect('a player melee kill of a zombie commits mob drops and experience through gameplay stages', () =>
    Effect.gen(function* () {
      const zombie = {
        id: EntityId('zombie-drop-scenario-target'),
        kind: ZOMBIE_KIND,
        feetPosition: position(0, 64.72, -2),
        healthPoints: EntityHealthPoints(1),
      }
      const entities = { entities: [zombie], nextSerial: EntitySerial(1) }
      const slice = yield* makeSlice(undefined, {
        entities,
        playerPose: { feetPosition: position(0, 64, 0), yawRadians: 0, pitchRadians: 0 },
      })
      yield* Ref.set(slice.state.rollSeed, 133)

      yield* requestMeleeAttack(slice.state, {
        requestId: 'kill-zombie-for-drops',
        origin: position(0, 64, 0),
        direction: position(0, 0, 1),
        reach: AttackRangeDistance(3),
        damage: 20,
      })
      yield* runFrame(slice.stages)

      expect(yield* drainMeleeAttackResults(slice.state)).toMatchObject([{
        requestId: 'kill-zombie-for-drops',
        success: true,
        target: { id: zombie.id },
      }])
      expect(yield* Ref.get(slice.state.mobDrops)).toMatchObject([
        { source: zombie.id, kind: ZOMBIE_KIND, item: 'rotten_flesh' },
      ])
      const dropped = yield* slice.commit.coordinator.snapshot(
        GAMEPLAY_DROPPED_ITEMS_OWNER_ID,
        DroppedItemOwnerSnapshotSchema,
      )
      expect(dropped.state.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ behaviour: expect.objectContaining({ item: 'rotten_flesh', count: expect.any(Number) }) }),
      ]))
      expect(yield* Ref.get(slice.state.mobExperience)).toMatchObject([
        { source: zombie.id, kind: ZOMBIE_KIND, amount: 5 },
      ])
    }),
  )

  it.effect('a wooden-sword melee casualty drops raw beef from the prepared damage result', () =>
    Effect.gen(function* () {
      const cow = {
        id: EntityId('cow-drop-scenario-target'),
        kind: COW_KIND,
        feetPosition: position(0, 64.72, -2),
        healthPoints: EntityHealthPoints(3),
      }
      const entities = { entities: [cow], nextSerial: EntitySerial(1) }
      const slots = [...inventorySlots()]
      slots[0] = Result.getOrThrow(itemStack('wooden_sword', 1))
      const slice = yield* makeSlice(slots, {
        entities,
        playerPose: { feetPosition: position(0, 64, 0), yawRadians: 0, pitchRadians: 0 },
      })
      yield* Ref.set(slice.state.rollSeed, 3)

      yield* requestMeleeAttack(slice.state, {
        requestId: 'kill-cow-with-prepared-sword-damage',
        origin: position(0, 64, 0),
        direction: position(0, 0, 1),
        reach: AttackRangeDistance(3),
        damage: 1,
        toolLocation: { _tag: 'Inventory', slotIndex: 0 },
      })
      yield* runFrame(slice.stages)

      expect(yield* drainMeleeAttackResults(slice.state)).toMatchObject([{
        requestId: 'kill-cow-with-prepared-sword-damage',
        success: true,
        target: { id: cow.id },
      }])
      expect((yield* slice.commit.coordinator.snapshot(
        GAMEPLAY_ENTITIES_OWNER_ID,
        GameplayEntityRosterSchema,
      )).state.entities).toStrictEqual([])
      const drops = yield* Ref.get(slice.state.mobDrops)
      expect(drops.some(({ source, kind, item, count }) =>
        source === cow.id && kind === COW_KIND && item === 'beef' && count > 0,
      )).toBe(true)
    }),
  )

  it.effect('routes a clicked lever to the block-use result with the same position', () =>
    Effect.gen(function* () {
      const leverPosition = blockPosition(2, 64, 3)
      const lever = Option.getOrThrow(blockIdOf('lever'))
      const slice = yield* makeSlice(undefined, {}, world([[leverPosition, lever]]))

      yield* requestBlockUse(slice.state, 'use-lever', leverPosition)
      yield* runFrame(slice.stages)

      expect(yield* drainBlockUseResults(slice.state)).toMatchObject([{
        requestId: 'use-lever',
        success: true,
        outcome: { _tag: 'ToggleLever', position: leverPosition },
      }])
    }),
  )
})
